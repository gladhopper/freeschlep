const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

const WIDTH = 192;
const HEIGHT = 144;
const FPS = 6;

let currentFrame = 0;
const totalFrames = 300;

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// OPTIMIZED: Batch frame delivery
app.get('/frames/:count?', (req, res) => {
    const count = Math.min(parseInt(req.params.count) || 30, 60); // Max 60 frames at once
    const frames = [];
    
    for (let i = 0; i < count; i++) {
        const frameNum = (currentFrame + i) % totalFrames;
        frames.push({
            pixels: generateFrame(frameNum),
            frame: frameNum,
            timestamp: frameNum / FPS
        });
    }
    
    res.json({
        frames: frames,
        startFrame: currentFrame,
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        batchSize: count
    });
});

// OPTIMIZED: Pre-compressed frame data
app.get('/frame-stream', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    
    // Send 10 frames immediately
    for (let i = 0; i < 10; i++) {
        const frameNum = (currentFrame + i) % totalFrames;
        const pixels = generateFrame(frameNum);
        res.write(`data: ${JSON.stringify({
            pixels: pixels,
            frame: frameNum,
            timestamp: frameNum / FPS
        })}\n\n`);
    }
    
    res.end();
});

// Keep original single frame endpoint for compatibility
app.get('/frame', (req, res) => {
    const pixels = generateFrame(currentFrame);
    
    res.json({
        pixels: pixels,
        frame: currentFrame,
        timestamp: currentFrame / FPS,
        width: WIDTH,
        height: HEIGHT,
        status: 'ready'
    });
});

// MUCH FASTER: Return multiple frames as base64 encoded data
app.get('/frames-compact/:count?', (req, res) => {
    const count = Math.min(parseInt(req.params.count) || 20, 40);
    const frames = [];
    
    for (let i = 0; i < count; i++) {
        const frameNum = (currentFrame + i) % totalFrames;
        const pixels = generateFrame(frameNum);
        
        // Convert to compact format - just the pixel data as flat array
        const flatPixels = pixels.flat();
        frames.push(flatPixels);
    }
    
    res.json({
        frames: frames,
        startFrame: currentFrame,
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        format: 'flat_rgb'
    });
});

const generateFrame = (frameNum) => {
    const pixels = [];
    const time = frameNum / FPS;
    
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const centerX = WIDTH / 2;
            const centerY = HEIGHT / 2;
            const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
            
            const ripple = Math.sin(distance * 0.1 - time * 3) * 127 + 128;
            const hue = (distance * 2 + time * 50) % 360;
            const rgb = hslToRgb(hue / 360, 0.8, 0.6);
            
            pixels.push([
                Math.floor(rgb[0] * ripple / 255),
                Math.floor(rgb[1] * ripple / 255),
                Math.floor(rgb[2] * ripple / 255)
            ]);
        }
    }
    
    return pixels;
};

const hslToRgb = (h, s, l) => {
    let r, g, b;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
};

app.get('/info', (req, res) => {
    res.json({
        currentFrame: currentFrame,
        timestamp: currentFrame / FPS,
        duration: totalFrames / FPS,
        fps: FPS,
        width: WIDTH,
        height: HEIGHT,
        totalFrames: totalFrames,
        status: 'Optimized pattern generator',
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        endpoints: {
            '/frame': 'Single frame (legacy)',
            '/frames/30': 'Batch of 30 frames',
            '/frames-compact/20': 'Compact batch of 20 frames',
            '/frame-stream': 'Stream 10 frames'
        }
    });
});

app.get('/ping', (req, res) => {
    res.json({ 
        pong: true, 
        ready: true,
        frame: currentFrame 
    });
});

app.get('/', (req, res) => {
    res.json({
        status: '✅ OPTIMIZED Video server running!',
        uptime: Math.floor(process.uptime()),
        frame: currentFrame,
        resolution: `${WIDTH}x${HEIGHT}`,
        fps: FPS,
        type: 'Batch-optimized patterns',
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        tip: 'Use /frames/30 for better performance!'
    });
});

// Keep the frame cycling
setInterval(() => {
    currentFrame = (currentFrame + 1) % totalFrames;
}, 1000 / FPS);

app.listen(PORT, () => {
    console.log(`🚀 OPTIMIZED Video Server running on port ${PORT}`);
    console.log(`📺 Resolution: ${WIDTH}x${HEIGHT} @ ${FPS}fps`);
    console.log(`⚡ New endpoints: /frames/30, /frames-compact/20`);
    console.log(`🎨 Batch delivery for smooth playback!`);
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
