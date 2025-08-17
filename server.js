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

// Use local s.mp4 in the same directory as server.js
const VIDEO_PATH = path.join(__dirname, 's.mp4');

const FPS = 10; // Increased from 6 to 10 like your working version
const WIDTH = 192;
const HEIGHT = 144;

let currentFrame = 0;
let videoDuration = 60;
let lastPixels = [];
let isProcessing = false;

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Simplified video duration check
const getVideoDuration = () => {
    return new Promise((resolve) => {
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

// Initialize
(async () => {
    console.log('🚀 Starting FAST video server...');
    
    if (!fs.existsSync(VIDEO_PATH)) {
        console.error(`❌ Video file not found: ${VIDEO_PATH}`);
        // Create test pattern
        lastPixels = Array(WIDTH * HEIGHT).fill(0).map((_, i) => {
            const x = i % WIDTH;
            const y = Math.floor(i / WIDTH);
            return [
                Math.floor((x / WIDTH) * 255),
                Math.floor((y / HEIGHT) * 255),
                128
            ];
        });
        console.log('🎨 Using test pattern');
    } else {
        videoDuration = await getVideoDuration();
        console.log(`📺 Video duration: ${videoDuration}s`);
        console.log(`🎬 Total frames: ${Math.floor(videoDuration * FPS)}`);
        console.log(`📊 Resolution: ${WIDTH}x${HEIGHT} (${WIDTH * HEIGHT} pixels)`);
        console.log(`⚡ Target FPS: ${FPS}`);
        
        // Start processing immediately
        startProcessing();
    }
})();

// Simplified, fast processing like your working version
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
            try {
                const pixels = [];
                for (let i = 0; i < pixelBuffer.length; i += 3) {
                    if (i + 2 < pixelBuffer.length) {
                        pixels.push([pixelBuffer[i], pixelBuffer[i + 1], pixelBuffer[i + 2]]);
                    }
                }
                lastPixels = pixels;
                currentFrame = (currentFrame + 1) % Math.floor(videoDuration * FPS);
                
                // Log every 5 seconds
                if (currentFrame % (FPS * 5) === 0) {
                    console.log(`✅ Frame ${currentFrame} (${seekTime.toFixed(2)}s) - ${pixels.length} pixels`);
                }
            } catch (error) {
                console.error('Pixel processing error:', error.message);
            }
            isProcessing = false;
        });
        
        outputStream.on('error', (err) => {
            console.error('Stream error:', err.message);
            isProcessing = false;
        });
        
        // SIMPLIFIED FFMPEG - like your working version
        ffmpeg(VIDEO_PATH)
            .seekInput(seekTime)
            .frames(1)
            .size(`${WIDTH}x${HEIGHT}`)
            .outputOptions('-pix_fmt rgb24')  // ONLY essential option
            .format('rawvideo')
            .on('error', (err) => {
                console.error('FFmpeg error:', err.message);
                isProcessing = false;
            })
            .pipe(outputStream);
            
    }, 1000 / FPS); // Match your working version timing
};

// Status endpoints
app.get('/', (req, res) => {
    res.json({
        status: '✅ FAST Video server running',
        uptime: Math.floor(process.uptime()),
        frame: currentFrame,
        timestamp: currentFrame / FPS,
        duration: videoDuration,
        resolution: `${WIDTH}x${HEIGHT}`,
        fps: FPS,
        pixelsCount: lastPixels.length,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    });
});

app.get('/ping', (req, res) => {
    res.json({
        pong: true,
        time: new Date().toISOString(),
        frame: currentFrame,
        hasPixels: lastPixels.length > 0
    });
});

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
    const memory = process.memoryUsage();
    res.json({
        currentFrame,
        timestamp: currentFrame / FPS,
        duration: videoDuration,
        fps: FPS,
        width: WIDTH,
        height: HEIGHT,
        totalFrames: Math.floor(videoDuration * FPS),
        isProcessing,
        pixelCount: lastPixels.length,
        expectedPixels: WIDTH * HEIGHT,
        memoryUsage: {
            heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memory.heapTotal / 1024 / 1024)
        }
    });
});

app.listen(PORT, () => {
    console.log(`🚀 FAST Video Server running on port ${PORT}`);
    console.log(`📺 Resolution: ${WIDTH}x${HEIGHT} @ ${FPS}fps`);
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
