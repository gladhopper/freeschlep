const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const fs = require('fs');
const { PassThrough } = require('stream');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const app = express();
const PORT = process.env.PORT || 10000;
const VIDEO_PATH = path.join(__dirname, 's.mp4');

// EXACT COPY of your working version but with 192x144
const FPS = 10;
const WIDTH = 192;   // Changed from 160 to 192
const HEIGHT = 144;  // Changed from 120 to 144

let currentFrame = 0;
let videoDuration = 0;
let lastPixels = []; // SAME as working version - single frame storage
let isProcessing = false;

// IDENTICAL CORS setup
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
});

// IDENTICAL duration function
const getVideoDuration = () => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(VIDEO_PATH, (err, metadata) => {
            if (err) {
                console.warn('ffprobe failed, using fallback duration');
                resolve(60);
            } else {
                resolve(metadata.format.duration);
            }
        });
    });
};

// IDENTICAL initialization
(async () => {
    try {
        videoDuration = await getVideoDuration();
        console.log(`Video duration: ${videoDuration}s`);
        console.log(`Total frames: ${Math.floor(videoDuration * FPS)}`);
        console.log(`Resolution: ${WIDTH}x${HEIGHT} (${WIDTH * HEIGHT} pixels) - 1:1 Mapping`);
        console.log(`Target FPS: ${FPS}`);
    } catch (err) {
        console.error('Could not get video duration:', err);
        videoDuration = 60;
    }
})();

// IDENTICAL background processing from working version - NO CHANGES
setInterval(() => {
    if (isProcessing || !videoDuration) return;
   
    isProcessing = true;
    const seekTime = currentFrame / FPS;
    let pixelBuffer = Buffer.alloc(0);
   
    const outputStream = new PassThrough();
   
    outputStream.on('data', chunk => {
        pixelBuffer = Buffer.concat([pixelBuffer, chunk]);
    });
   
    outputStream.on('end', () => {
        const pixels = [];
        for (let i = 0; i < pixelBuffer.length; i += 3) {
            pixels.push([pixelBuffer[i], pixelBuffer[i + 1], pixelBuffer[i + 2]]);
        }
        lastPixels = pixels;
        currentFrame = (currentFrame + 1) % Math.floor(videoDuration * FPS);
        isProcessing = false;
       
        if (currentFrame % (FPS * 5) === 0) {
            console.log(`Processed frame ${currentFrame} (${seekTime.toFixed(2)}s)`);
        }
    });
   
    ffmpeg(VIDEO_PATH)
        .seekInput(seekTime)
        .frames(1)
        .size(`${WIDTH}x${HEIGHT}`)
        .outputOptions('-pix_fmt rgb24')
        .format('rawvideo')
        .on('error', (err) => {
            console.error('FFmpeg error:', err);
            isProcessing = false;
        })
        .pipe(outputStream);
       
}, 1000 / FPS);

// IDENTICAL endpoints
app.get('/frame', (req, res) => {
    res.json({
        pixels: lastPixels,
        frame: currentFrame,
        timestamp: currentFrame / FPS,
        width: WIDTH,
        height: HEIGHT
    });
});

app.get('/info', (req, res) => {
    res.json({
        currentFrame,
        timestamp: currentFrame / FPS,
        duration: videoDuration,
        fps: FPS,
        width: WIDTH,
        height: HEIGHT,
        totalFrames: Math.floor(videoDuration * FPS),
        isProcessing
    });
});

app.get('/', (req, res) => {
    res.json({
        status: 'Video server running - EXACT WORKING COPY',
        frame: currentFrame,
        timestamp: currentFrame / FPS,
        duration: videoDuration,
        resolution: `${WIDTH}x${HEIGHT}`,
        fps: FPS,
        pixelsCount: lastPixels.length,
        isProcessing
    });
});

app.listen(PORT, () => {
    console.log(`Video pixel server running at port ${PORT}`);
    console.log(`Resolution: ${WIDTH}x${HEIGHT} (${WIDTH * HEIGHT} pixels)`);
    console.log(`Target FPS: ${FPS}`);
});

// Keep-alive for production
if (process.env.NODE_ENV === 'production') {
    setInterval(() => {
        try {
            const url = process.env.RENDER_EXTERNAL_URL;
            if (url) {
                require('https').get(`${url}/ping`);
            }
        } catch (err) {
            // Silent fail
        }
    }, 14 * 60 * 1000);
}
