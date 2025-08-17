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

const FPS = 6;
const WIDTH = 192;
const HEIGHT = 144;

let currentFrame = 0;
let videoDuration = 60;
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
        videoPath: VIDEO_PATH,
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
        videoPath: VIDEO_PATH,
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

const analyzeVideo = async (videoPath) => {
    console.log(`📹 Analyzing video: ${videoPath}`);
    if (!fs.existsSync(videoPath)) {
        console.error(`❌ Video file not found: ${videoPath}`);
        return { duration: 60, error: 'Video file not found' };
    }
    try {
        const result = await new Promise((resolve) => {
            console.log('✅ File exists, analyzing with FFprobe...');
            runFFprobe(videoPath, resolve);
        });
        return result;
    } catch (error) {
        console.error(`❌ Analysis error: ${error.message}`);
        return { duration: 60, error: error.message };
    }
};

const runFFprobe = (videoPath, resolve) => {
    const timeout = setTimeout(() => {
        console.log('⏰ FFprobe timeout after 20 seconds');
        resolve({ duration: 60, error: 'FFprobe timeout' });
    }, 20000);

    ffmpeg.ffprobe(videoPath, ['-v', 'error', '-show_streams', '-show_format', '-print_format', 'json'], (err, metadata) => {
        clearTimeout(timeout);
        if (err) {
            console.error('❌ FFprobe failed:', err.message);
            console.error('FFprobe error details:', JSON.stringify(err, null, 2));
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
                duration: metadata.format.duration || 60,
                metadata: metadata,
                error: null
            });
        }
    });
};

(async () => {
    console.log('🚀 Starting DEBUG video server...');
    console.log(`📺 Target Resolution: ${WIDTH}x${HEIGHT} (${WIDTH * HEIGHT} pixels)`);
    console.log(`⚡ Target FPS: ${FPS}`);
    console.log(`📊 Expected buffer size: ${WIDTH * HEIGHT * 3} bytes`);

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

    videoInfo = await analyzeVideo(VIDEO_PATH);
    videoDuration = videoInfo.duration;
    if (videoInfo.error) {
        console.error(`❌ Video analysis failed: ${videoInfo.error}`);
        console.log('🎨 Will use test pattern only');
    } else {
        console.log(`⏱️ Video Duration: ${videoDuration}s`);
        console.log(`🎬 Total frames: ${Math.floor(videoDuration * FPS)}`);
        startProcessing(VIDEO_PATH);
        console.log('✅ Video processing started!');
    }
})();

const startProcessing = (videoPath) => {
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

        console.log(`🎞️ Processing frame ${currentFrame} at ${seekTime.toFixed(2)}s...`);

        try {
            const pixels = await processFrameWithDebug(videoPath, seekTime);
            if (pixels && pixels.length > 0) {
                lastPixels = pixels;
                consecutiveErrors = 0;
                console.log(`✅ Frame ${currentFrame} success: ${pixels.length} pixels`);
            } else {
                console.warn(`⚠️ Frame ${currentFrame} returned no pixels`);
                consecutiveErrors++;
            }
            currentFrame = (currentFrame + 1) % Math.floor(videoDuration * FPS);
        } catch (error) {
            console.error(`❌ Frame ${currentFrame} failed: ${error.message}`);
            consecutiveErrors++;
            if (consecutiveErrors > 2) {
                currentFrame = (currentFrame + FPS * 2) % Math.floor(videoDuration * FPS);
                console.log(`⏭️ Skipping to frame ${currentFrame} due to errors`);
            }
        }
        processingActive = false;
    };

    setInterval(processNextFrame, 167);
};

const processFrameWithDebug = (videoPath, seekTime) => {
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
        }, 15000);

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
                console.warn(`⚠️ Size mismatch: got ${pixelBuffer.length}, expected ${expectedSize}`);
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

        try {
            console.log(`🎬 Starting FFmpeg for frame at ${seekTime}s...`);
            const command = ffmpeg(videoPath)
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
                    '-avoid_negative_ts make_zero'
                ])
                .on('start', (cmd) => {
                    console.log(`🎬 FFmpeg started: seeking to ${seekTime}s`);
                })
                .on('stderr', (stderrLine) => {
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
        videoPath: VIDEO_PATH,
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
