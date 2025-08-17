const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const fs = require('fs');
const { PassThrough } = require('stream');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const app = express();
const PORT = process.env.PORT || 10000;
const VIDEO_PATH = 'C:/Users/waffles/Downloads/h.mp4';

const FPS = 10; // Target FPS
const WIDTH = 192;
const HEIGHT = 144;

let currentFrame = 0;
let videoDuration = 0;
let lastPixels = [];
let isProcessing = false;
let actualProcessingTime = 0;

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

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

// FIX: Only advance frame AFTER processing completes
const processNextFrame = async () => {
    if (isProcessing || !videoDuration) {
        return; // Don't stack processing requests
    }
    
    isProcessing = true;
    const seekTime = currentFrame / FPS;
    const startTime = Date.now();
    
    console.log(`🎬 Processing frame ${currentFrame} at ${seekTime.toFixed(2)}s`);
    
    try {
        const pixels = await processFrame(seekTime);
        
        if (pixels && pixels.length > 0) {
            lastPixels = pixels;
            actualProcessingTime = Date.now() - startTime;
            
            console.log(`✅ Frame ${currentFrame} complete in ${actualProcessingTime}ms`);
            
            // Only advance after successful processing
            currentFrame = (currentFrame + 1) % Math.floor(videoDuration * FPS);
        } else {
            console.warn(`⚠️ Frame ${currentFrame} failed - skipping`);
            currentFrame = (currentFrame + 1) % Math.floor(videoDuration * FPS);
        }
        
    } catch (error) {
        console.error(`❌ Processing failed for frame ${currentFrame}:`, error.message);
        // Skip problematic frame
        currentFrame = (currentFrame + 1) % Math.floor(videoDuration * FPS);
    }
    
    isProcessing = false;
    
    // FIX: Wait for processing to complete, then schedule next
    scheduleNextFrame();
};

// FIX: Adaptive timing based on actual processing speed
const scheduleNextFrame = () => {
    // Calculate delay based on target FPS and actual processing time
    const targetInterval = 1000 / FPS; // e.g., 100ms for 10fps
    const delay = Math.max(50, targetInterval - actualProcessingTime); // Minimum 50ms delay
    
    setTimeout(processNextFrame, delay);
};

const processFrame = (seekTime) => {
    return new Promise((resolve, reject) => {
        let pixelBuffer = Buffer.alloc(0);
        const outputStream = new PassThrough();
        
        const timeout = setTimeout(() => {
            console.log(`⏰ Timeout for frame at ${seekTime}s`);
            reject(new Error('Processing timeout'));
        }, 10000);
        
        outputStream.on('data', chunk => {
            pixelBuffer = Buffer.concat([pixelBuffer, chunk]);
        });
        
        outputStream.on('end', () => {
            clearTimeout(timeout);
            
            const pixels = [];
            for (let i = 0; i < pixelBuffer.length; i += 3) {
                pixels.push([pixelBuffer[i], pixelBuffer[i + 1], pixelBuffer[i + 2]]);
            }
            
            resolve(pixels);
        });
        
        outputStream.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        
        // Optimized FFmpeg command
        const command = ffmpeg(VIDEO_PATH)
            .seekInput(seekTime)
            .frames(1)
            .size(`${WIDTH}x${HEIGHT}`)
            .outputOptions([
                '-pix_fmt rgb24',
                '-preset ultrafast',
                '-tune zerolatency',
                '-threads 1',
                '-an',
                '-sws_flags fast_bilinear'
            ])
            .format('rawvideo')
            .on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
            
        command.pipe(outputStream);
    });
};

// Initialize
(async () => {
    try {
        videoDuration = await getVideoDuration();
        console.log(`✅ Video: ${videoDuration}s, ${Math.floor(videoDuration * FPS)} frames`);
        
        // Create fallback pattern
        lastPixels = Array(WIDTH * HEIGHT).fill(0).map((_, i) => {
            const x = i % WIDTH;
            const y = Math.floor(i / WIDTH);
            return [
                Math.floor((x / WIDTH) * 255),
                Math.floor((y / HEIGHT) * 255),
                128
            ];
        });
        
        console.log(`🚀 Starting adaptive processing at ${FPS}fps target`);
        
        // Start the processing chain
        processNextFrame();
        
    } catch (err) {
        console.error('Initialization failed:', err);
        videoDuration = 60;
    }
})();

// API endpoints
app.get('/frame', (req, res) => {
    res.json({
        pixels: lastPixels,
        frame: currentFrame,
        timestamp: currentFrame / FPS,
        width: WIDTH,
        height: HEIGHT,
        isProcessing: isProcessing,
        processingTimeMs: actualProcessingTime,
        actualFPS: actualProcessingTime > 0 ? (1000 / actualProcessingTime).toFixed(1) : 'N/A'
    });
});

app.get('/info', (req, res) => {
    const actualFPS = actualProcessingTime > 0 ? 1000 / actualProcessingTime : 0;
    
    res.json({
        currentFrame,
        timestamp: currentFrame / FPS,
        duration: videoDuration,
        targetFPS: FPS,
        actualFPS: actualFPS.toFixed(1),
        width: WIDTH,
        height: HEIGHT,
        totalFrames: Math.floor(videoDuration * FPS),
        isProcessing,
        avgProcessingTime: actualProcessingTime + 'ms',
        status: isProcessing ? 'Processing...' : 'Ready',
        pixelCount: lastPixels.length
    });
});

app.get('/ping', (req, res) => {
    res.json({
        pong: true,
        frame: currentFrame,
        isProcessing,
        uptime: Math.floor(process.uptime())
    });
});

app.get('/', (req, res) => {
    const actualFPS = actualProcessingTime > 0 ? (1000 / actualProcessingTime).toFixed(1) : 'N/A';
    
    res.json({
        status: '📺 Adaptive Video Server',
        frame: currentFrame,
        targetFPS: FPS,
        actualFPS: actualFPS,
        processing: isProcessing ? 'Active' : 'Ready',
        uptime: Math.floor(process.uptime()) + 's',
        resolution: `${WIDTH}x${HEIGHT}`
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Adaptive Video Server on port ${PORT}`);
    console.log(`📺 Target: ${WIDTH}x${HEIGHT} @ ${FPS}fps`);
    console.log(`⚡ Adaptive timing prevents frame stacking`);
});

if (process.env.NODE_ENV === 'production') {
    setInterval(() => {
        try {
            const url = process.env.RENDER_EXTERNAL_URL;
            if (url) {
                require('https').get(`${url}/ping`);
            }
        } catch (err) {}
    }, 14 * 60 * 1000);
}
