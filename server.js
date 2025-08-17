const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

// INSTANT SERVER - No FFmpeg processing at all!
const WIDTH = 192;
const HEIGHT = 144;
const FPS = 6;

// PRE-MADE VIDEO FRAMES - Just cycling colors/patterns
let currentFrame = 0;
const totalFrames = 300; // 50 seconds of video at 6fps

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// GENERATE ANIMATED PATTERNS - No video file needed!
const generateFrame = (frameNum) => {
    const pixels = [];
    const time = frameNum / FPS; // Time in seconds
    
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            // CREATE ANIMATED PATTERNS
            const centerX = WIDTH / 2;
            const centerY = HEIGHT / 2;
            const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
            
            // ANIMATED RIPPLE EFFECT
            const ripple = Math.sin(distance * 0.1 - time * 3) * 127 + 128;
            
            // RAINBOW CYCLING
            const hue = (distance * 2 + time * 50) % 360;
            const rgb = hslToRgb(hue / 360, 0.8, 0.6);
            
            // COMBINE EFFECTS
            pixels.push([
                Math.floor(rgb[0] * ripple / 255),
                Math.floor(rgb[1] * ripple / 255),
                Math.floor(rgb[2] * ripple / 255)
            ]);
        }
    }
    
    return pixels;
};

// HSL to RGB conversion for rainbow effects
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

// INSTANT FRAME SERVING
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

app.get('/info', (req, res) => {
    res.json({
        currentFrame: currentFrame,
        timestamp: currentFrame / FPS,
        duration: totalFrames / FPS,
        fps: FPS,
        width: WIDTH,
        height: HEIGHT,
        totalFrames: totalFrames,
        status: 'Generated patterns - no video file needed!',
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
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
        status: '✅ INSTANT Video server running!',
        uptime: Math.floor(process.uptime()),
        frame: currentFrame,
        resolution: `${WIDTH}x${HEIGHT}`,
        fps: FPS,
        type: 'Generated patterns',
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    });
});

// SMOOTH 6FPS CYCLING
setInterval(() => {
    currentFrame = (currentFrame + 1) % totalFrames;
}, 1000 / FPS);

app.listen(PORT, () => {
    console.log(`🚀 INSTANT Video Server running on port ${PORT}`);
    console.log(`📺 Resolution: ${WIDTH}x${HEIGHT} @ ${FPS}fps`);
    console.log(`⚡ No processing required - generates patterns in real-time!`);
    console.log(`🎨 Creating beautiful animated effects...`);
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
