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

const VIDEO_URL = process.env.VIDEO_URL || 'https://files.catbox.moe/4ajlnv.mp4'; // i know this isnt really sophie rain but ima use to troll lil kids

const FPS = 10;
const WIDTH = 160;
const HEIGHT = 120;

let currentFrame = 0;
let videoDuration = 0;
let lastPixels = [];
let isProcessing = false;

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

app.get('/', (req, res) => {
    res.json({
        status: '✅ Video server running',
        uptime: Math.floor(process.uptime()),
        frame: currentFrame,
        timestamp: currentFrame / FPS,
        videoUrl: VIDEO_URL,
        duration: videoDuration
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

// Video duration check with URL
const getVideoDuration = () => {
    return new Promise((resolve) => {
        console.log(`📹 Analyzing video: ${VIDEO_URL}`);
        
        ffmpeg.ffprobe(VIDEO_URL, (err, metadata) => {
            if (err) {
                console.warn('⚠️  ffprobe failed, using fallback duration');
                console.error(err.message);
                resolve(60);
            } else {
                console.log('✅ Video metadata loaded successfully');
                resolve(metadata.format.duration);
            }
        });
    });
};

// Initialize
(async () => {
    console.log('🚀 Starting video server...');
    console.log(`📹 Video URL: ${VIDEO_URL}`);
    
    videoDuration = await getVideoDuration();
    console.log(`⏱️  Duration: ${videoDuration}s`);
    console.log(`🎬 Total frames: ${Math.floor(videoDuration * FPS)}`);
    console.log(`📺 Resolution: ${WIDTH}x${HEIGHT} pixels`);
    
    if (VIDEO_URL && VIDEO_URL !== 'https://your-video-url-here.mp4') {
        startProcessing();
        console.log('✅ Video processing started!');
    } else {
        console.log('⚠️  Set VIDEO_URL environment variable to enable streaming');
        // Create rainbow test pattern for demo
        lastPixels = Array(WIDTH * HEIGHT).fill(0).map((_, i) => {
            const x = i % WIDTH;
            const y = Math.floor(i / WIDTH);
            return [
                Math.floor((x / WIDTH) * 255),
                Math.floor((y / HEIGHT) * 255),
                128
            ];
        });
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
        
        ffmpeg(VIDEO_URL) // Use URL instead of file path
            .seekInput(seekTime)
            .frames(1)
            .size(`${WIDTH}x${HEIGHT}`)
            .outputOptions('-pix_fmt rgb24')
            .format('rawvideo')
            .on('error', (err) => {
                console.error('FFmpeg error:', err.message);
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
        videoUrl: VIDEO_URL,
        hasValidUrl: VIDEO_URL && VIDEO_URL !== 'https://your-video-url-here.mp4'
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Render will provide the public URL`);
});

if (process.env.NODE_ENV === 'production') {
    const selfPing = () => {
        try {
            const url = process.env.RENDER_EXTERNAL_URL;
            if (url) {
                require('https').get(`${url}/ping`);
                console.log('🏓 Self-ping sent');
            }
        } catch (err) {
        }
    };
    
    setInterval(selfPing, 14 * 60 * 1000); // Every 14 minutes
}
