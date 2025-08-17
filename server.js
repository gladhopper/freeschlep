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
const FPS = 6;
const WIDTH = 192;
const HEIGHT = 144;

// OPTIMIZATION 1: Frame cache to avoid re-processing
const frameCache = new Map();
const CACHE_SIZE = 100; // Cache 100 frames (~16 seconds at 6fps)

// OPTIMIZATION 2: Batch processing state
let currentFrame = 0;
let videoDuration = 60;
let lastPixels = [];
let isProcessing = false;
let consecutiveErrors = 0;
let videoInfo = null;
let batchProcessor = null;

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

const analyzeVideo = async (videoPath) => {
    console.log(`📹 Analyzing video: ${videoPath}`);
    if (!fs.existsSync(videoPath)) {
        console.error(`❌ Video file not found: ${videoPath}`);
        return { duration: 60, error: 'Video file not found' };
    }
    
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve({ duration: 60, error: 'FFprobe timeout' });
        }, 10000);

        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            clearTimeout(timeout);
            if (err) {
                resolve({ duration: 60, error: err.message });
            } else {
                resolve({
                    duration: metadata.format.duration || 60,
                    metadata: metadata,
                    error: null
                });
            }
        });
    });
};

// OPTIMIZATION 3: Batch process multiple frames at once
class BatchFrameProcessor {
    constructor(videoPath, fps, width, height) {
        this.videoPath = videoPath;
        this.fps = fps;
        this.width = width;
        this.height = height;
        this.isProcessing = false;
        this.queue = [];
    }

    async processFrameBatch(startFrame, count = 10) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        console.log(`🎬 Batch processing ${count} frames starting from ${startFrame}`);

        try {
            const startTime = startFrame / this.fps;
            const frames = await this.extractFrames(startTime, count);
            
            // Cache all the frames
            frames.forEach((pixels, index) => {
                const frameNum = startFrame + index;
                frameCache.set(frameNum, pixels);
                
                // Keep cache size manageable
                if (frameCache.size > CACHE_SIZE) {
                    const oldestKey = frameCache.keys().next().value;
                    frameCache.delete(oldestKey);
                }
            });

            console.log(`✅ Cached ${frames.length} frames (cache size: ${frameCache.size})`);
        } catch (error) {
            console.error(`❌ Batch processing failed: ${error.message}`);
        }

        this.isProcessing = false;
    }

    extractFrames(startTime, count) {
        return new Promise((resolve, reject) => {
            let frameData = [];
            let currentFrameBuffer = Buffer.alloc(0);
            const expectedFrameSize = this.width * this.height * 3;
            let framesReceived = 0;

            const outputStream = new PassThrough();

            const timeout = setTimeout(() => {
                reject(new Error('Batch processing timeout'));
            }, 30000);

            outputStream.on('data', chunk => {
                currentFrameBuffer = Buffer.concat([currentFrameBuffer, chunk]);
                
                // Check if we have complete frames
                while (currentFrameBuffer.length >= expectedFrameSize) {
                    const frameBuffer = currentFrameBuffer.slice(0, expectedFrameSize);
                    currentFrameBuffer = currentFrameBuffer.slice(expectedFrameSize);
                    
                    // Convert frame buffer to pixels
                    const pixels = [];
                    for (let i = 0; i < frameBuffer.length; i += 3) {
                        pixels.push([frameBuffer[i], frameBuffer[i + 1], frameBuffer[i + 2]]);
                    }
                    
                    frameData.push(pixels);
                    framesReceived++;
                    
                    if (framesReceived >= count) {
                        clearTimeout(timeout);
                        resolve(frameData);
                        return;
                    }
                }
            });

            outputStream.on('end', () => {
                clearTimeout(timeout);
                resolve(frameData);
            });

            outputStream.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });

            // OPTIMIZATION 4: More efficient FFmpeg command
            const command = ffmpeg(this.videoPath)
                .seekInput(startTime)
                .frames(count)
                .size(`${this.width}x${this.height}`)
                .outputOptions([
                    '-pix_fmt rgb24',
                    '-f rawvideo',
                    '-threads 2',
                    '-preset ultrafast',
                    '-an',
                    '-sws_flags fast_bilinear'
                ])
                .on('error', reject);
                
            command.pipe(outputStream);
        });
    }
}

// OPTIMIZATION 5: Predictive caching
const startPredictiveCaching = () => {
    setInterval(async () => {
        if (!batchProcessor || batchProcessor.isProcessing) return;
        
        // Cache frames ahead of current position
        const lookahead = 20; // Cache 20 frames ahead
        const targetFrame = (currentFrame + lookahead) % Math.floor(videoDuration * FPS);
        
        // Only process if we don't have this frame cached
        if (!frameCache.has(targetFrame)) {
            await batchProcessor.processFrameBatch(targetFrame, 10);
        }
    }, 2000); // Check every 2 seconds
};

const startProcessing = (videoPath) => {
    batchProcessor = new BatchFrameProcessor(videoPath, FPS, WIDTH, HEIGHT);
    
    // Process initial batch
    batchProcessor.processFrameBatch(0, 30);
    
    // Start predictive caching
    startPredictiveCaching();

    // Frame advancement (much faster now with cache)
    setInterval(() => {
        // Check if we have the current frame cached
        if (frameCache.has(currentFrame)) {
            lastPixels = frameCache.get(currentFrame);
            consecutiveErrors = 0;
        } else {
            console.log(`⚠️ Cache miss for frame ${currentFrame}`);
            consecutiveErrors++;
            
            // Trigger immediate batch processing for missing frames
            if (!batchProcessor.isProcessing) {
                batchProcessor.processFrameBatch(currentFrame, 10);
            }
        }
        
        currentFrame = (currentFrame + 1) % Math.floor(videoDuration * FPS);
    }, 1000 / FPS);
};

// API Endpoints
app.get('/frame', (req, res) => {
    res.json({
        pixels: lastPixels,
        frame: currentFrame,
        timestamp: currentFrame / FPS,
        width: WIDTH,
        height: HEIGHT,
        cached: frameCache.has(currentFrame),
        cacheSize: frameCache.size,
        errors: consecutiveErrors
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
        cacheSize: frameCache.size,
        cacheHitRate: frameCache.has(currentFrame) ? '100%' : '0%',
        isProcessing: batchProcessor?.isProcessing || false,
        consecutiveErrors,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    });
});

app.get('/cache-status', (req, res) => {
    const cachedFrames = Array.from(frameCache.keys()).sort((a, b) => a - b);
    res.json({
        cacheSize: frameCache.size,
        cachedFrames: cachedFrames.slice(0, 20), // Show first 20
        currentFrame,
        nextCached: cachedFrames.find(f => f > currentFrame),
        isProcessing: batchProcessor?.isProcessing || false
    });
});

app.get('/ping', (req, res) => {
    res.json({
        pong: true,
        frame: currentFrame,
        cached: frameCache.has(currentFrame),
        cacheSize: frameCache.size
    });
});

app.get('/', (req, res) => {
    res.json({
        status: '✅ OPTIMIZED Video server running!',
        uptime: Math.floor(process.uptime()),
        frame: currentFrame,
        resolution: `${WIDTH}x${HEIGHT}`,
        fps: FPS,
        cacheSize: frameCache.size,
        optimization: 'Batch processing + Frame cache',
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    });
});

// Initialize
(async () => {
    console.log('🚀 Starting OPTIMIZED video server...');
    
    // Create test pattern as fallback
    lastPixels = Array(WIDTH * HEIGHT).fill(0).map((_, i) => {
        const x = i % WIDTH;
        const y = Math.floor(i / WIDTH);
        return [
            Math.floor((x / WIDTH) * 255),
            Math.floor((y / HEIGHT) * 255),
            Math.floor(((x + y) / (WIDTH + HEIGHT)) * 255)
        ];
    });

    videoInfo = await analyzeVideo(VIDEO_PATH);
    videoDuration = videoInfo.duration;
    
    if (videoInfo.error) {
        console.error(`❌ Video error: ${videoInfo.error}`);
        console.log('🎨 Using test pattern only');
    } else {
        console.log(`✅ Video loaded: ${videoDuration}s`);
        startProcessing(VIDEO_PATH);
    }
})();

app.listen(PORT, () => {
    console.log(`🚀 OPTIMIZED Video Server on port ${PORT}`);
    console.log(`📺 ${WIDTH}x${HEIGHT} @ ${FPS}fps`);
    console.log(`⚡ Optimizations: Frame cache + Batch processing`);
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
