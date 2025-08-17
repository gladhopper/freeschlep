const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const fs = require('fs');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const PORT = process.env.PORT || 10000;
const VIDEO_PATH = path.join(__dirname, 's.mp4');

const FPS = 6;
const WIDTH = 192;
const HEIGHT = 144;

// PRE-PROCESSED FRAMES - Much faster!
let preProcessedFrames = [];
let currentFrameIndex = 0;
let videoDuration = 60;
let isPreProcessing = false;
let totalFrames = 0;

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// FAST frame serving - no processing during requests!
app.get('/frame', (req, res) => {
    if (preProcessedFrames.length === 0) {
        // Return test pattern if no frames ready
        const testPixels = Array(WIDTH * HEIGHT).fill(0).map((_, i) => {
            const x = i % WIDTH;
            const y = Math.floor(i / WIDTH);
            return [
                Math.floor((x / WIDTH) * 255),
                Math.floor((y / HEIGHT) * 128),
                Math.floor(((x + y) / (WIDTH + HEIGHT)) * 255)
            ];
        });
        return res.json({
            pixels: testPixels,
            frame: 0,
            timestamp: 0,
            status: 'preprocessing'
        });
    }

    const frame = preProcessedFrames[currentFrameIndex];
    res.json({
        pixels: frame,
        frame: currentFrameIndex,
        timestamp: currentFrameIndex / FPS,
        width: WIDTH,
        height: HEIGHT,
        totalFrames: preProcessedFrames.length,
        status: 'ready'
    });
});

app.get('/info', (req, res) => {
    res.json({
        currentFrame: currentFrameIndex,
        timestamp: currentFrameIndex / FPS,
        duration: videoDuration,
        fps: FPS,
        width: WIDTH,
        height: HEIGHT,
        totalFrames: preProcessedFrames.length,
        isPreProcessing: isPreProcessing,
        progress: preProcessedFrames.length + '/' + totalFrames,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    });
});

app.get('/ping', (req, res) => {
    res.json({ 
        pong: true, 
        ready: preProcessedFrames.length > 0,
        frames: preProcessedFrames.length 
    });
});

// PRE-PROCESS ALL FRAMES ON STARTUP
const preProcessVideo = async () => {
    if (isPreProcessing || !fs.existsSync(VIDEO_PATH)) {
        console.log('❌ Video file not found or already processing');
        return;
    }

    console.log('🚀 PRE-PROCESSING video for maximum speed...');
    isPreProcessing = true;

    try {
        // Get video duration
        const metadata = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(VIDEO_PATH, (err, data) => {
                if (err) reject(err);
                else resolve(data);
            });
        });

        videoDuration = metadata.format.duration;
        totalFrames = Math.floor(videoDuration * FPS);
        console.log(`📺 Video: ${videoDuration}s, ${totalFrames} frames to process`);

        // PRE-PROCESS ALL FRAMES IN BATCHES
        const batchSize = 30; // Process 30 frames at once
        for (let batch = 0; batch < Math.ceil(totalFrames / batchSize); batch++) {
            const startFrame = batch * batchSize;
            const endFrame = Math.min((batch + 1) * batchSize, totalFrames);
            
            console.log(`🎬 Processing batch ${batch + 1}: frames ${startFrame}-${endFrame}`);
            
            await processBatch(startFrame, endFrame);
            
            console.log(`✅ Batch ${batch + 1} complete! (${preProcessedFrames.length}/${totalFrames})`);
        }

        console.log(`🎉 PRE-PROCESSING COMPLETE! ${preProcessedFrames.length} frames ready`);
        console.log(`💾 Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
        
    } catch (error) {
        console.error('❌ Pre-processing failed:', error.message);
    }
    
    isPreProcessing = false;
};

// BATCH PROCESSING - Much faster!
const processBatch = async (startFrame, endFrame) => {
    const promises = [];
    
    for (let frameNum = startFrame; frameNum < endFrame; frameNum++) {
        const seekTime = frameNum / FPS;
        promises.push(processFrame(seekTime, frameNum));
        
        // Don't overwhelm the system
        if (promises.length >= 5) {
            const results = await Promise.allSettled(promises.splice(0, 5));
            results.forEach((result, i) => {
                if (result.status === 'fulfilled' && result.value) {
                    preProcessedFrames[startFrame + i] = result.value;
                }
            });
        }
    }
    
    // Process remaining frames
    if (promises.length > 0) {
        const results = await Promise.allSettled(promises);
        results.forEach((result, i) => {
            if (result.status === 'fulfilled' && result.value) {
                preProcessedFrames[startFrame + promises.length - results.length + i] = result.value;
            }
        });
    }
};

// SIMPLIFIED frame processing
const processFrame = (seekTime, frameNum) => {
    return new Promise((resolve, reject) => {
        let pixelBuffer = Buffer.alloc(0);
        
        const timeout = setTimeout(() => {
            reject(new Error(`Frame ${frameNum} timeout`));
        }, 5000); // Much shorter timeout
        
        const command = ffmpeg(VIDEO_PATH)
            .seekInput(seekTime)
            .frames(1)
            .size(`${WIDTH}x${HEIGHT}`)
            .outputOptions([
                '-pix_fmt rgb24',
                '-f rawvideo',
                '-preset ultrafast',
                '-threads 1'
            ])
            .on('end', () => {
                clearTimeout(timeout);
                
                // Convert buffer to pixel array
                const pixels = [];
                for (let i = 0; i < pixelBuffer.length; i += 3) {
                    if (i + 2 < pixelBuffer.length) {
                        pixels.push([
                            pixelBuffer[i],
                            pixelBuffer[i + 1],
                            pixelBuffer[i + 2]
                        ]);
                    }
                }
                
                resolve(pixels.length === WIDTH * HEIGHT ? pixels : null);
            })
            .on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });

        // Collect all data
        command.pipe().on('data', chunk => {
            pixelBuffer = Buffer.concat([pixelBuffer, chunk]);
        });
    });
};

// FRAME CYCLING - Smooth 6fps playback
setInterval(() => {
    if (preProcessedFrames.length > 0) {
        currentFrameIndex = (currentFrameIndex + 1) % preProcessedFrames.length;
    }
}, 1000 / FPS); // Exactly 6fps

// START THE SERVER
app.listen(PORT, () => {
    console.log(`🚀 FAST Video Server running on port ${PORT}`);
    console.log(`📺 Resolution: ${WIDTH}x${HEIGHT} @ ${FPS}fps`);
    console.log(`⚡ Pre-processing mode: ALL frames processed at startup`);
    
    // Start pre-processing
    setTimeout(preProcessVideo, 1000);
});

// Keep-alive for Render
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
