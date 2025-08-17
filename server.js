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

const VIDEO_URL = process.env.VIDEO_URL || 'https://files.catbox.moe/4ajlnv.mp4';

// Your preferred quality settings
const FPS = 6;  // Perfect for smooth playback with less processing
const WIDTH = 192;   // Higher horizontal resolution
const HEIGHT = 144;  // Higher vertical resolution

let currentFrame = 0;
let videoDuration = 0;
let lastPixels = [];
let isProcessing = false;
let consecutiveErrors = 0;
let processingQueue = [];

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

app.get('/', (req, res) => {
    res.json({
        status: '✅ Video server running (Quality Mode)',
        uptime: Math.floor(process.uptime()),
        frame: currentFrame,
        timestamp: currentFrame / FPS,
        videoUrl: VIDEO_URL,
        duration: videoDuration,
        errors: consecutiveErrors,
        resolution: `${WIDTH}x${HEIGHT}`,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    });
});

app.get('/ping', (req, res) => {
    res.json({ 
        pong: true, 
        time: new Date().toISOString(),
        frame: currentFrame
    });
});

// Optimized video duration check
const getVideoDuration = () => {
    return new Promise((resolve) => {
        console.log(`📹 Analyzing video: ${VIDEO_URL}`);
        
        const timeout = setTimeout(() => {
            resolve(60);
        }, 10000);
        
        ffmpeg.ffprobe(VIDEO_URL, (err, metadata) => {
            clearTimeout(timeout);
            if (err) {
                console.warn('⚠️  Using fallback duration');
                resolve(60);
            } else {
                console.log('✅ Video loaded successfully');
                resolve(metadata.format.duration);
            }
        });
    });
};

// Initialize 
(async () => {
    console.log('🚀 Starting HIGH QUALITY video server...');
    console.log(`📺 Resolution: ${WIDTH}x${HEIGHT} (${WIDTH * HEIGHT} pixels) - FULL QUALITY!`);
    console.log(`⚡ FPS: ${FPS} (optimized for stability)`);
    
    // Create nice gradient test pattern
    lastPixels = Array(WIDTH * HEIGHT).fill(0).map((_, i) => {
        const x = i % WIDTH;
        const y = Math.floor(i / WIDTH);
        return [
            Math.floor((x / WIDTH) * 255),
            Math.floor((y / HEIGHT) * 255), 
            150
        ];
    });
    
    videoDuration = await getVideoDuration();
    console.log(`⏱️  Duration: ${videoDuration}s`);
    console.log(`🎬 Total frames: ${Math.floor(videoDuration * FPS)}`);
    
    if (VIDEO_URL && VIDEO_URL !== 'https://your-video-url-here.mp4') {
        startOptimizedProcessing();
        console.log('✅ HIGH QUALITY processing started!');
    }
})();

// Smart processing with memory management
const startOptimizedProcessing = () => {
    let processingActive = false;
    
    const processNextFrame = async () => {
        if (processingActive || consecutiveErrors > 8) {
            if (consecutiveErrors > 8) {
                // Reset errors after waiting
                setTimeout(() => {
                    consecutiveErrors = Math.max(0, consecutiveErrors - 3);
                }, 5000);
            }
            return;
        }
        
        processingActive = true;
        const seekTime = currentFrame / FPS;
        
        try {
            const pixels = await processFrame(seekTime);
            
            if (pixels && pixels.length > 0) {
                lastPixels = pixels;
                consecutiveErrors = Math.max(0, consecutiveErrors - 1); // Reduce errors on success
                
                // Log progress every 5 seconds
                if (currentFrame % (FPS * 5) === 0) {
                    console.log(`🎞️  Frame ${currentFrame} (${seekTime.toFixed(1)}s) - ${pixels.length} pixels`);
                }
            }
            
            currentFrame = (currentFrame + 1) % Math.floor(videoDuration * FPS);
            
        } catch (error) {
            console.error(`❌ Processing error: ${error.message}`);
            consecutiveErrors++;
            
            // Skip problematic frames
            if (consecutiveErrors > 3) {
                currentFrame = (currentFrame + FPS) % Math.floor(videoDuration * FPS);
                console.log(`⏭️  Skipping to frame ${currentFrame}`);
            }
        }
        
        processingActive = false;
    };
    
    // Process frames every 167ms (6 FPS)
    setInterval(processNextFrame, 167);
};

// Optimized frame processing function
const processFrame = (seekTime) => {
    return new Promise((resolve, reject) => {
        let pixelBuffer = Buffer.alloc(0);
        let hasCompleted = false;
        
        const outputStream = new PassThrough();
        
        // Aggressive timeout to prevent hanging
        const timeout = setTimeout(() => {
            if (!hasCompleted) {
                hasCompleted = true;
                reject(new Error('Processing timeout'));
            }
        }, 8000);
        
        outputStream.on('data', chunk => {
            if (!hasCompleted) {
                pixelBuffer = Buffer.concat([pixelBuffer, chunk]);
            }
        });
        
        outputStream.on('end', () => {
            if (hasCompleted) return;
            hasCompleted = true;
            clearTimeout(timeout);
            
            try {
                const pixels = [];
                const expectedSize = WIDTH * HEIGHT * 3;
                
                if (pixelBuffer.length !== expectedSize) {
                    console.warn(`⚠️  Buffer size mismatch: got ${pixelBuffer.length}, expected ${expectedSize}`);
                }
                
                // Process with bounds checking
                for (let i = 0; i < pixelBuffer.length && i < expectedSize; i += 3) {
                    if (i + 2 < pixelBuffer.length) {
                        pixels.push([
                            pixelBuffer[i],
                            pixelBuffer[i + 1], 
                            pixelBuffer[i + 2]
                        ]);
                    }
                }
                
                resolve(pixels);
                
            } catch (error) {
                reject(error);
            }
        });
        
        outputStream.on('error', (error) => {
            if (!hasCompleted) {
                hasCompleted = true;
                clearTimeout(timeout);
                reject(error);
            }
        });
        
        // Optimized FFmpeg command for memory efficiency
        try {
            ffmpeg(VIDEO_URL)
                .seekInput(seekTime)
                .frames(1)
                .size(`${WIDTH}x${HEIGHT}`)
                .outputOptions([
                    '-pix_fmt rgb24',
                    '-threads 1',           // Single thread
                    '-preset ultrafast',    // Fastest processing
                    '-tune zerolatency',    // Low latency
                    '-an',                  // No audio
                    '-sws_flags bilinear',  // Faster scaling
                    '-f rawvideo'           // Raw output format
                ])
                .on('start', () => {
                    // Frame processing started
                })
                .on('error', (err) => {
                    if (!hasCompleted) {
                        hasCompleted = true;
                        clearTimeout(timeout);
                        reject(err);
                    }
                })
                .pipe(outputStream);
                
        } catch (error) {
            if (!hasCompleted) {
                hasCompleted = true;
                clearTimeout(timeout);
                reject(error);
            }
        }
    });
};

// API endpoints
app.get('/frame', (req, res) => {
    res.json({
        pixels: lastPixels,
        frame: currentFrame,
        timestamp: currentFrame / FPS,
        width: WIDTH,
        height: HEIGHT,
        quality: 'HIGH'
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
        videoUrl: VIDEO_URL,
        consecutiveErrors,
        memoryUsage: {
            heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
            external: Math.round(memory.external / 1024 / 1024)
        },
        quality: 'HIGH_RESOLUTION'
    });
});

app.listen(PORT, () => {
    console.log(`🚀 HIGH QUALITY Video Server running on port ${PORT}`);
    console.log(`📺 Full resolution: ${WIDTH}x${HEIGHT} @ ${FPS}fps`);
    console.log(`💎 Quality preserved!`);
});

// Memory cleanup and self-ping
if (process.env.NODE_ENV === 'production') {
    // Aggressive memory cleanup
    setInterval(() => {
        const usage = process.memoryUsage();
        const heapMB = Math.round(usage.heapUsed / 1024 / 1024);
        
        if (heapMB > 450) {
            console.log(`🧹 Memory cleanup: ${heapMB}MB`);
            if (global.gc) {
                global.gc();
            }
        }
    }, 30000); // Every 30 seconds
    
    // Self-ping
    const selfPing = () => {
        try {
            const url = process.env.RENDER_EXTERNAL_URL;
            if (url) {
                require('https').get(`${url}/ping`);
            }
        } catch (err) {
            // Silent fail
        }
    };
    setInterval(selfPing, 14 * 60 * 1000);
}
