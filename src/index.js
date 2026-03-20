const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: [
      process.env.CLIENT_URL,
      'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175',
      'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:5175'
    ],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Make io accessible to routes
app.set('io', io);

// Security Middleware
app.use(helmet({
  crossOriginResourcePolicy: false,
}));
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 5000 : 200, // Very high for development
  message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use(limiter);

// CORS
app.use(cors({
  origin: [
    process.env.CLIENT_URL,
    'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175',
    'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:5175'
  ],
  credentials: true
}));


app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Static files for uploads
app.use('/uploads', express.static('uploads'));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB Connected');
    // Pre-build Docker images for code execution (non-blocking)
    const { buildAllImages, isDockerAvailable } = require('./services/dockerExecutor');
    isDockerAvailable().then(available => {
      if (available) {
        buildAllImages().catch(err => console.warn('⚠️ Docker image pre-build warning:', err.message));
      } else {
        console.log('ℹ️  Docker not available - using Piston API for code execution');
      }
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/assessments', require('./routes/assessments'));
app.use('/api/attempts', require('./routes/attempts'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin/batches', require('./routes/adminBatches'));
app.use('/api/admin/sections', require('./routes/sections'));
app.use('/api/admin/questions', require('./routes/questions'));
app.use('/api/upload', require('./routes/uploadRoute'));
app.use('/api/compiler', require('./routes/compiler'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/registration', require('./routes/registration'));
app.use('/api/placements', require('./routes/placements'));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Socket.io Events
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Join admin room for monitoring
  socket.on('join_admin_room', (adminId) => {
    socket.join(`admin_${adminId}`);
    socket.join('admins');
    console.log(`Admin ${adminId} joined monitoring room`);
  });

  // Join assessment room
  socket.on('join_assessment', ({ assessmentId, studentId }) => {
    socket.join(`assessment_${assessmentId}`);
    socket.data.assessmentId = assessmentId;
    socket.data.studentId = studentId;
    socket.to(`assessment_${assessmentId}`).emit('student_joined', { studentId, timestamp: new Date() });
  });

  // Student activity events
  socket.on('student_activity', (data) => {
    socket.to(`assessment_${data.assessmentId}`).emit('student_activity_update', data);
  });

  // Kickout event
  socket.on('student_kickout', (data) => {
    io.to(`assessment_${data.assessmentId}`).emit('student_kicked', data);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
    if (socket.data.assessmentId) {
      socket.to(`assessment_${socket.data.assessmentId}`).emit('student_disconnected', {
        studentId: socket.data.studentId,
        timestamp: new Date()
      });
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = { app, io };
