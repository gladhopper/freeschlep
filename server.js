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
const PORT = process.env.PORT || 10000; // Render uses port 10000

// Put your video file as 'video.mp4' in the repo
const VIDEO_PATH = path.join(__dirname, 'video.mp4');

const FPS = 10;
const WIDTH = 160;
const HEIGHT = 120;

let currentFrame = 0;
let videoDuration = 0;
let lastPixels = [];
let isProcessing = false;

// CORS for Roblox
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Health endpoint (prevents sleeping)
app.get('/', (req, res) => {
    res.json({
        status: '✅ Video server running',
        uptime: Math.floor(process.uptime()),
        frame: currentFrame,
        timestamp: currentFrame / FPS,
        videoExists: fs.existsSync(VIDEO_PATH)
    });
});

// Keep-alive endpoint (call this every 10 minutes to prevent sleep)
app.get('/ping', (req, res) => {
    res.json({ 
        pong: true, 
        time: new Date().toISOString(),
        frame: currentFrame 
    });
});

// Video duration check
const getVideoDuration = () => {
    return new Promise((resolve) => {
        if (!fs.existsSync(VIDEO_PATH)) {
            console.log('⚠️  Video file not found, using test mode');
            resolve(60);
            return;
        }
        
        ffmpeg.ffprobe(VIDEO_PATH, (err, metadata) => {
            if (err) {
                console.warn('⚠️  ffprobe failed, using fallback');
                resolve(60);
            } else {
                resolve(metadata.format.duration);
            }
        });
    });
};

// Initialize
(async () => {
    videoDuration = await getVideoDuration();
    console.log(`📹 Duration: ${videoDuration}s`);
    console.log(`🎬 Frames: ${Math.floor(videoDuration * FPS)}`);
    console.log(`📺 Resolution: ${WIDTH}x${HEIGHT}`);
    
    if (fs.existsSync(VIDEO_PATH)) {
        startProcessing();
        console.log('🚀 Video processing started!');
    } else {
        console.log('📁 Add video.mp4 to enable video streaming');
        // Create dummy data for testing
        lastPixels = Array(WIDTH * HEIGHT).fill([255, 0, 255]); // Purple test pattern
    }
})();

// Video processing
const startProcessing = () => {
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
};

// API endpoints (same as your original)
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
        isProcessing,
        videoExists: fs.existsSync(VIDEO_PATH)
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Render will provide the public URL`);
});

// Self-ping to prevent sleeping (every 14 minutes)
if (process.env.NODE_ENV === 'production') {
    const selfPing = () => {
        try {
            // This will be your Render URL
            const url = process.env.RENDER_EXTERNAL_URL;
            if (url) {
                require('https').get(`${url}/ping`);
                console.log('🏓 Self-ping sent');
            }
        } catch (err) {
            // Silent fail
        }
    };
    
    setInterval(selfPing, 14 * 60 * 1000); // Every 14 minutes
}
