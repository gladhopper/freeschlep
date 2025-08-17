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

const VIDEO_URL = process.env.VIDEO_URL || 'https://filebin.net/1wksoufjs2ponoo8/h.mp4';

const FPS = 6;
const WIDTH = 192;
const HEIGHT = 144;

let currentFrame = 0;
let videoDuration = 0;
let lastPixels = [];
let isProcessing = false;
let consecutiveErrors = 0;
let videoInfo = null;

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

app.get('/', (req, res) => {
    res.json({
        status: '✅ Video server running (Debug Mode)',
        uptime: Math.floor(process.uptime()),
        frame: currentFrame,
        timestamp: currentFrame / FPS,
        videoUrl: VIDEO_URL,
        duration: videoDuration,
        errors: consecutiveErrors,
        resolution: `${WIDTH}x${HEIGHT}`,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        videoInfo: videoInfo ? 'Loaded' : 'Failed',
        pixelsCount: lastPixels.length
    });
});

app.get('/ping', (req, res) => {
    res.json({ 
        pong: true, 
        time: new Date().toISOString(),
        frame: currentFrame,
        errors: consecutiveErrors,
        hasPixels: lastPixels.length > 0
    });
});

app.get('/debug', (req, res) => {
    res.json({
        videoUrl: VIDEO_URL,
        videoInfo: videoInfo,
        currentFrame: currentFrame,
        duration: videoDuration,
        consecutiveErrors: consecutiveErrors,
        isProcessing: isProcessing,
        pixelDataLength: lastPixels.length,
        expectedPixels: WIDTH * HEIGHT,
        memoryUsage: process.memoryUsage()
    });
});

// Enhanced video analysis with better error handling
const analyzeVideo = () => {
    return new Promise((resolve) => {
        console.log(`📹 Analyzing video URL: ${VIDEO_URL}`);
        console.log(`🔍 Testing URL accessibility...`);
        
        // Test if URL is accessible first
        const https = require('https');
        const http = require('http');
        const client = VIDEO_URL.startsWith('https') ? https : http;
        
        const testRequest = client.request(VIDEO_URL.replace(/\?.*/, ''), { method: 'HEAD' }, (res) => {
            console.log(`📡 URL Response: ${res.statusCode} ${res.statusMessage}`);
            console.log(`📦 Content-Type: ${res.headers['content-type']}`);
            console.log(`📏 Content-Length: ${res.headers['content-length']}`);
            
            if (res.statusCode === 200) {
                console.log('✅ URL is accessible, analyzing with FFprobe...');
                runFFprobe(resolve);
            } else {
                console.error('❌ URL not accessible:', res.statusCode);
                resolve({ duration: 60, error: `HTTP ${res.statusCode}` });
            }
        });
        
        testRequest.on('error', (error) => {
            console.error('❌ URL test failed:', error.message);
            resolve({ duration: 60, error: error.message });
        });
        
        testRequest.setTimeout(10000, () => {
            console.error('⏰ URL test timeout');
            testRequest.destroy();
            resolve({ duration: 60, error: 'Timeout' });
        });
        
        testRequest.end();
    });
};

const runFFprobe = (resolve) => {
    const timeout = setTimeout(() => {
        console.log('⏰ FFprobe timeout after 15 seconds');
        resolve({ duration: 60, error: 'FFprobe timeout' });
    }, 15000);
    
    ffmpeg.ffprobe(VIDEO_URL, {timeout: 10}, (err, metadata) => {
        clearTimeout(timeout);
        
        if (err) {
            console.error('❌ FFprobe failed:', err.message);
            resolve({ duration: 60, error: err.message });
        } else {
            console.log('✅ Video analysis complete!');
            console.log(`   Duration: ${metadata.format.duration}s`);
            console.log(`   Format: ${metadata.format.format_name}`);
            console.log(`   Size: ${metadata.format.size} bytes`);
            
            if (metadata.streams && metadata.streams[0]) {
                const videoStream = metadata.streams.find(s => s.codec_type === 'video');
                if (videoStream) {
                    console.log(`   Video: ${videoStream.width}x${videoStream.height}`);
                    console.log(`   Codec: ${videoStream.codec_name}`);
                    console.log(`   FPS: ${videoStream.r_frame_rate}`);
                }
            }
            
            resolve({
                duration: metadata.format.duration,
                metadata: metadata,
                error: null
            });
        }
    });
};

// Initialize with better debugging
(async () => {
    console.log('🚀 Starting DEBUG video server...');
    console.log(`📺 Target Resolution: ${WIDTH}x${HEIGHT} (${WIDTH * HEIGHT} pixels)`);
    console.log(`⚡ Target FPS: ${FPS}`);
    console.log(`📊 Expected buffer size: ${WIDTH * HEIGHT * 3} bytes`);
    
    // Create test pattern first
    console.log('🎨 Creating test pattern...');
    lastPixels = Array(WIDTH * HEIGHT).fill(0).map((_, i) => {
        const x = i % WIDTH;
        const y = Math.floor(i / WIDTH);
        return [
            Math.floor((x / WIDTH) * 255),
            Math.floor((y / HEIGHT) * 255), 
            Math.floor(((x + y) / (WIDTH + HEIGHT)) * 255)
        ];
    });
    console.log(`✅ Test pattern created: ${lastPixels.length} pixels`);
    
    // Analyze video
    videoInfo = await analyzeVideo();
    videoDuration = videoInfo.duration;
    
    if (videoInfo.error) {
        console.error(`❌ Video analysis failed: ${videoInfo.error}`);
        console.log('🎨 Will use test pattern only');
    } else {
        console.log(`⏱️  Video Duration: ${videoDuration}s`);
        console.log(`🎬 Total frames: ${Math.floor(videoDuration * FPS)}`);
        
        if (VIDEO_URL && VIDEO_URL !== 'https://your-video-url-here.mp4') {
            startProcessing();
            console.log('✅ Video processing started!');
        }
    }
})();

// Enhanced processing with detailed debugging
const startProcessing = () => {
    let processingActive = false;
    
    const processNextFrame = async () => {
        if (processingActive || consecutiveErrors > 5) {
            if (consecutiveErrors > 5) {
                console.log('🛑 Too many consecutive errors, pausing...');
                setTimeout(() => {
                    consecutiveErrors = 0;
                    console.log('🔄 Resetting error count, resuming...');
                }, 10000);
            }
            return;
        }
        
        processingActive = true;
        const seekTime = currentFrame / FPS;
        
        console.log(`🎞️  Processing frame ${currentFrame} at ${seekTime.toFixed(2)}s...`);
        
        try {
            const pixels = await processFrameWithDebug(seekTime);
            
            if (pixels && pixels.length > 0) {
                lastPixels = pixels;
                consecutiveErrors = 0;
                console.log(`✅ Frame ${currentFrame} success: ${pixels.length} pixels`);
            } else {
                console.warn(`⚠️  Frame ${currentFrame} returned no pixels`);
                consecutiveErrors++;
            }
            
            currentFrame = (currentFrame + 1) % Math.floor(videoDuration * FPS);
            
        } catch (error) {
            console.error(`❌ Frame ${currentFrame} failed: ${error.message}`);
            consecutiveErrors++;
            
            // Skip ahead on repeated failures
            if (consecutiveErrors > 2) {
                currentFrame = (currentFrame + FPS * 2) % Math.floor(videoDuration * FPS);
                console.log(`⏭️  Skipping to frame ${currentFrame} due to errors`);
            }
        }
        
        processingActive = false;
    };
    
    setInterval(processNextFrame, 167); // 6 FPS
};

// Enhanced frame processing with detailed logging
const processFrameWithDebug = (seekTime) => {
    return new Promise((resolve, reject) => {
        let pixelBuffer = Buffer.alloc(0);
        let hasCompleted = false;
        let bytesReceived = 0;
        
        const outputStream = new PassThrough();
        
        const timeout = setTimeout(() => {
            if (!hasCompleted) {
                hasCompleted = true;
                console.log(`⏰ Timeout processing frame at ${seekTime}s`);
                reject(new Error('Processing timeout'));
            }
        }, 12000); // Longer timeout for debugging
        
        outputStream.on('data', chunk => {
            if (!hasCompleted) {
                pixelBuffer = Buffer.concat([pixelBuffer, chunk]);
                bytesReceived += chunk.length;
            }
        });
        
        outputStream.on('end', () => {
            if (hasCompleted) return;
            hasCompleted = true;
            clearTimeout(timeout);
            
            const expectedSize = WIDTH * HEIGHT * 3;
            console.log(`📊 Buffer info: received ${pixelBuffer.length} bytes, expected ${expectedSize}`);
            
            if (pixelBuffer.length === 0) {
                console.error('❌ Empty buffer - FFmpeg produced no output');
                reject(new Error('Empty buffer from FFmpeg'));
                return;
            }
            
            if (pixelBuffer.length !== expectedSize) {
                console.warn(`⚠️  Size mismatch: got ${pixelBuffer.length}, expected ${expectedSize}`);
            }
            
            try {
                const pixels = [];
                for (let i = 0; i < pixelBuffer.length && i < expectedSize; i += 3) {
                    if (i + 2 < pixelBuffer.length) {
                        pixels.push([
                            pixelBuffer[i],
                            pixelBuffer[i + 1], 
                            pixelBuffer[i + 2]
                        ]);
                    }
                }
                
                console.log(`✅ Processed ${pixels.length} pixels from ${pixelBuffer.length} bytes`);
                resolve(pixels);
                
            } catch (error) {
                console.error('❌ Pixel processing error:', error.message);
                reject(error);
            }
        });
        
        outputStream.on('error', (error) => {
            if (!hasCompleted) {
                hasCompleted = true;
                clearTimeout(timeout);
                console.error('❌ Output stream error:', error.message);
                reject(error);
            }
        });
        
        // FFmpeg command with extra debugging
        try {
            console.log(`🎬 Starting FFmpeg for frame at ${seekTime}s...`);
            
            const command = ffmpeg(VIDEO_URL)
                .seekInput(seekTime)
                .frames(1)
                .size(`${WIDTH}x${HEIGHT}`)
                .outputOptions([
                    '-pix_fmt rgb24',
                    '-threads 1',
                    '-preset ultrafast',
                    '-tune zerolatency',
                    '-an',
                    '-sws_flags bilinear',
                    '-f rawvideo',
                    '-avoid_negative_ts make_zero'  // Handle timestamp issues
                ])
                .on('start', (cmd) => {
                    console.log(`🎬 FFmpeg started: seeking to ${seekTime}s`);
                })
                .on('stderr', (stderrLine) => {
                    // Log important FFmpeg messages
                    if (stderrLine.includes('Error') || stderrLine.includes('failed')) {
                        console.log(`FFmpeg: ${stderrLine}`);
                    }
                })
                .on('error', (err) => {
                    if (!hasCompleted) {
                        hasCompleted = true;
                        clearTimeout(timeout);
                        console.error('❌ FFmpeg error:', err.message);
                        reject(err);
                    }
                });
            
            command.pipe(outputStream);
                
        } catch (error) {
            if (!hasCompleted) {
                hasCompleted = true;
                clearTimeout(timeout);
                console.error('❌ FFmpeg setup error:', error.message);
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
        errors: consecutiveErrors
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
        pixelCount: lastPixels.length,
        expectedPixels: WIDTH * HEIGHT,
        videoInfo: videoInfo,
        memoryUsage: {
            heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memory.heapTotal / 1024 / 1024)
        }
    });
});

app.listen(PORT, () => {
    console.log(`🚀 DEBUG Video Server running on port ${PORT}`);
    console.log(`📺 Resolution: ${WIDTH}x${HEIGHT} @ ${FPS}fps`);
    console.log(`🔧 Debug endpoints: /debug, /info, /ping`);
});

// Self-ping for Render
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
