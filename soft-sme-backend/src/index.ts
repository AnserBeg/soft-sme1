import dotenv from 'dotenv';
import path from 'path';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import expressWs from 'express-ws';
import { pool } from './db';
import { authMiddleware } from './middleware/authMiddleware';

// Load environment variables - only load from .env file in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

const DEFAULT_TESSERACT_BINARY = '/usr/bin/tesseract';

if (!process.env.TESSERACT_CMD && process.env.TESSERACT_PATH) {
  process.env.TESSERACT_CMD = process.env.TESSERACT_PATH;
}

if (!process.env.TESSERACT_PATH && process.env.TESSERACT_CMD) {
  process.env.TESSERACT_PATH = process.env.TESSERACT_CMD;
}

if (!process.env.TESSERACT_CMD && !process.env.TESSERACT_PATH) {
  process.env.TESSERACT_CMD = DEFAULT_TESSERACT_BINARY;
  process.env.TESSERACT_PATH = DEFAULT_TESSERACT_BINARY;
}

// Import routes
import authRoutes from './routes/authRoutes';
import businessProfileRoutes from './routes/businessProfile';
import customerRoutes from './routes/customerRoutes';
import productRoutes from './routes/productRoutes';
import purchaseHistoryRoutes from './routes/purchaseHistoryRoutes';
import marginScheduleRoutes from './routes/marginScheduleRoutes';
import vendorRoutes from './routes/vendorRoutes';
import inventoryRoutes from './routes/inventoryRoutes';
import categoryRoutes from './routes/categoryRoutes';
import quoteRoutes from './routes/quoteRoutes';
import salesOrderRoutes from './routes/salesOrderRoutes';
import purchaseOrderRoutes from './routes/purchaseOrderRoutes';
import purchaseOrderOcrRoutes from './routes/purchaseOrderOcrRoutes';
import employeeRoutes from './routes/employeeRoutes';
import timeTrackingRoutes from './routes/timeTrackingRoutes';
import leaveManagementRoutes from './routes/leaveManagementRoutes';
import globalSettingsRouter from './routes/globalSettingsRoutes';
import backupRoutes from './routes/backupRoutes';
import attendanceRouter from './routes/attendanceRoutes';
import qboAuthRoutes from './routes/qboAuthRoutes';
import qboAccountRoutes from './routes/qboAccountRoutes';
import qboExportRoutes from './routes/qboExportRoutes';
import overheadRoutes from './routes/overheadRoutes';
import aiAssistantRoutes from './routes/aiAssistantRoutes';
import emailRoutes from './routes/emailRoutes';
import profileDocumentRoutes from './routes/profileDocumentRoutes';
import messagingRoutes from './routes/messagingRoutes';
import agentV2Routes from './routes/agentV2Routes';
import voiceRoutes from './routes/voiceRoutes';
import voiceStreamRoutes from './routes/voiceStreamRoutes';
import voiceSearchRoutes from './routes/voiceSearchRoutes';
import taskRoutes from './routes/taskRoutes';
import aiAssistantService from './services/aiAssistantService';
import partFinderRoutes from './routes/partFinderRoutes';
import inventoryVendorRoutes from './routes/inventoryVendorRoutes';
import plannerRoutes from './routes/plannerRoutes';

const enableAiAssistantEnv = process.env.ENABLE_AI_ASSISTANT?.toLowerCase();
const shouldAutoStartAiAssistant = enableAiAssistantEnv === 'true';

// Add error handling around chatRouter import
let chatRouter: any;
try {
  console.log('[Index] Attempting to import chatRouter...');
  const chatModule = require('./routes/chatRoutes');
  chatRouter = chatModule.default;
  console.log('[Index] chatRouter imported successfully');
} catch (error) {
  console.error('[Index] Error importing chatRouter:', error);
  throw error;
}

// Subagent analytics removed - simplified AI implementation

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const HOST = process.env.HOST || '0.0.0.0';

// Initialize express-ws for WebSocket support
const wsInstance = expressWs(app);

const allowedOrigins = (
  [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'https://softsme.phoenixtrailers.ca',
    'https://soft-sme1.onrender.com',
    'https://soft-sme-frontend.onrender.com',
    process.env.CORS_ORIGIN,
  ] as (string | undefined)[]
)
  .filter((origin): origin is string => Boolean(origin))
  .map((origin) => origin.trim().toLowerCase());

const isAllowedOrigin = (originHeader?: string | null) => {
  if (!originHeader) {
    return true;
  }

  const normalizedOrigin = originHeader.trim().toLowerCase();

  if (normalizedOrigin.endsWith('.trycloudflare.com')) {
    return true;
  }

  return allowedOrigins.includes(normalizedOrigin);
};

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    console.warn(`[CORS] Blocked origin: ${origin ?? 'unknown'}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'x-device-id',
    'x-timezone',
    'X-Timezone',
  ],
  optionsSuccessStatus: 204,
};

app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;

  if (isAllowedOrigin(requestOrigin)) {
    if (requestOrigin) {
      res.header('Access-Control-Allow-Origin', requestOrigin);
    }
  }

  res.header('Access-Control-Allow-Credentials', 'true');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, x-device-id, x-timezone, X-Timezone'
  );
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  next();
});

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static('uploads'));

// Health check endpoint for connection warmup
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Lightweight health check for platform probes
app.get('/healthz', (_req, res) => {
  res.status(200).send('ok');
});

// Public routes
app.use('/api/auth', authRoutes);
console.log('Registered auth routes at /api/auth');

// Protected routes
app.use('/api/business-profile', businessProfileRoutes);
console.log('Registered business profile routes');

app.use('/api/customers', authMiddleware, customerRoutes);
console.log('Registered customer routes');

app.use('/api/products', authMiddleware, productRoutes);
console.log('Registered product routes');

app.use('/api/purchase-history', authMiddleware, purchaseHistoryRoutes);
console.log('Registered purchase history routes');

app.use('/api/margin-schedule', authMiddleware, marginScheduleRoutes);
console.log('Registered margin schedule routes');

app.use('/api/vendors', authMiddleware, vendorRoutes);
console.log('Registered vendor routes');

app.use('/api/inventory', authMiddleware, inventoryRoutes);
console.log('Registered inventory routes');

// Categories
app.use('/api/categories', authMiddleware, categoryRoutes);
console.log('Registered category routes');

app.use('/api/quotes', authMiddleware, quoteRoutes);
console.log('Registered quote routes');

app.use('/api/sales-orders', authMiddleware, salesOrderRoutes);
console.log('Registered sales order routes');

app.use('/api/purchase-orders', authMiddleware, purchaseOrderRoutes);
console.log('Registered purchase order routes');

app.use('/api/purchase-orders/ocr', authMiddleware, purchaseOrderOcrRoutes);
console.log('Registered purchase order OCR routes');

app.use('/api/employees', authMiddleware, employeeRoutes);
console.log('Registered employee routes');

app.use('/api/time-tracking', authMiddleware, timeTrackingRoutes);
console.log('Registered time tracking routes');

app.use('/api/leave-management', authMiddleware, leaveManagementRoutes);
console.log('Registered leave management routes');

app.use('/api/attendance', authMiddleware, attendanceRouter);
console.log('Registered attendance routes');

app.use('/api/settings', authMiddleware, globalSettingsRouter);
console.log('Registered global settings routes');

app.use('/api/backup', authMiddleware, backupRoutes);
console.log('Registered backup routes');

app.use('/api/qbo', qboAuthRoutes);
console.log('Registered QBO auth routes');

app.use('/api/qbo-accounts', authMiddleware, qboAccountRoutes);
console.log('Registered QBO account routes');

app.use('/api/qbo-export', authMiddleware, qboExportRoutes);
console.log('Registered QBO export routes');

app.use('/api/overhead', authMiddleware, overheadRoutes);
console.log('Registered overhead routes');

// AI Assistant routes
app.use('/api/ai-assistant', aiAssistantRoutes);
console.log('Registered AI assistant routes');

// Planner streaming routes
app.use('/api/planner', plannerRoutes);
console.log('Registered planner routes');

// Part Finder (SO-specific stats)
app.use('/api/part-finder', authMiddleware, partFinderRoutes);
console.log('Registered part finder routes');

// Inventory vendor mappings
app.use('/api/inventory', authMiddleware, inventoryVendorRoutes);
console.log('Registered inventory vendor routes');

// Email routes
app.use('/api/email', authMiddleware, emailRoutes);
console.log('Registered email routes');

// Profile document routes
app.use('/api/profile-documents', profileDocumentRoutes);
console.log('Registered profile document routes');

app.use('/api/messaging', authMiddleware, messagingRoutes);
console.log('Registered messaging routes');

app.use('/api/tasks', taskRoutes);
console.log('Registered task routes');

// Agent V2 routes (feature-flagged)
if (process.env.AI_ASSISTANT_V2 !== 'false') {
  app.use('/api/agent/v2', authMiddleware, agentV2Routes);
  console.log('Registered Agent V2 routes');
}

// Voice/calling routes (feature flag optional)
if (process.env.ENABLE_VENDOR_CALLING !== 'false') {
  // LiveKit/Telnyx: protect routes; no Twilio webhooks here anymore
  app.use('/api/voice', authMiddleware, voiceRoutes);
  // Register WebSocket routes with express-ws instance
  if (wsInstance) {
    app.use('/api/voice', voiceStreamRoutes);

// Voice search routes (always available)
app.use('/api/voice-search', authMiddleware, voiceSearchRoutes);
console.log('Registered voice search routes');
    
    // Add WebSocket endpoint directly to the main app
    (app as any).ws('/api/voice/stream', (ws: any, req: any) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const sessionId = url.searchParams.get('session_id');
      
      if (!sessionId) {
        ws.close(1008, 'Missing session_id');
        return;
      }
      
      const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
      console.log(`WebSocket stream connected for session: ${sessionId} from ${clientIp}`);
      
      // Import GeminiLiveBridge dynamically to avoid circular dependencies
      import('./services/voice/GeminiLiveBridge').then(({ GeminiLiveBridge }) => {
        // Create Gemini Live bridge for this session
        const geminiBridge = new GeminiLiveBridge(sessionId);
        
        ws.on('message', async (data: any) => {
          try {
            // Handle incoming audio from Twilio
            const audioData = JSON.parse(data.toString());
            if (audioData && audioData.event) {
              if (audioData.event === 'start') {
                console.log(`WS start for session ${sessionId}, streamSid=${audioData.start?.streamSid || audioData.streamSid}`);
              } else if (audioData.event === 'media') {
                // Light log to confirm media flow without dumping payload
                if (audioData.media?.track) {
                  console.log(`WS media for session ${sessionId}, track=${audioData.media.track}`);
                }
              } else if (audioData.event === 'stop') {
                console.log(`WS stop for session ${sessionId}`);
              }
            }
            
            if (audioData.event === 'media' && audioData.media?.payload) {
              // Forward audio to Gemini Live
              const response = await geminiBridge.processAudio(audioData.media.payload);
              
              if (response.functionCall) {
                // Handle function calls from Gemini
                await handleGeminiFunctionCall(sessionId, response.functionCall);
              }
            } else if (audioData.event === 'start' || audioData.event === 'stop') {
              // Acknowledge lifecycle events silently
            }
          } catch (error) {
            console.error('WebSocket message error:', error);
          }
        });
        
        ws.on('close', (code: number, reason: any) => {
          const reasonStr = typeof reason === 'string' ? reason : (reason?.toString?.() || '');
          console.log(`WebSocket stream disconnected for session: ${sessionId} code=${code} reason=${reasonStr}`);
          geminiBridge.cleanup();
        });
        
        ws.on('error', (error: any) => {
          console.error(`WebSocket stream error for session ${sessionId}:`, error);
        });
      }).catch(error => {
        console.error('Failed to load GeminiLiveBridge:', error);
        ws.close(1011, 'Service unavailable');
      });
    });
    
    // Helper function to handle Gemini function calls
    async function handleGeminiFunctionCall(sessionId: string, functionCall: any) {
      try {
        const { name, args } = functionCall;

        switch (name) {
          case 'set_pickup_time':
            await updateCallSession(sessionId, {
              pickup_time: args.pickup_time,
              pickup_location: args.pickup_location,
              pickup_contact_person: args.pickup_contact_person,
              pickup_phone: args.pickup_phone,
              pickup_instructions: args.pickup_instructions
            });
            // Also update the purchase order with pickup details
            await updatePurchaseOrderPickupDetails(sessionId, args);
            break;
          case 'set_vendor_email':
            await updateCallSession(sessionId, { captured_email: args.email });
            break;
          case 'order_part':
            await updateCallSession(sessionId, {
              parts_ordered: args.parts,
              order_details: args.details
            });
            break;
          case 'send_po_pdf':
            await updateCallSession(sessionId, { po_email_sent: true });
            break;
          default:
            console.log(`Unknown function call: ${name}`);
        }
      } catch (error) {
        console.error('Error handling Gemini function call:', error);
      }
    }

    async function updateCallSession(sessionId: string, updates: any) {
      try {
        await pool.query(
          'UPDATE vendor_call_sessions SET updated_at = NOW() WHERE id = $1',
          [sessionId]
        );
        console.log(`Updated call session ${sessionId}`);
      } catch (error) {
        console.error('Error updating call session:', error);
      }
    }

    async function updatePurchaseOrderPickupDetails(sessionId: string, pickupDetails: any) {
      try {
        // Get the purchase_id from the call session
        const sessionResult = await pool.query(
          'SELECT purchase_id FROM vendor_call_sessions WHERE id = $1',
          [sessionId]
        );

        if (sessionResult.rows.length === 0) {
          console.error('Call session not found for pickup details update');
          return;
        }

        const purchaseId = sessionResult.rows[0].purchase_id;

        // Update the purchase order with pickup details
        await pool.query(`
          UPDATE purchasehistory
          SET
            pickup_time = $1,
            pickup_location = $2,
            pickup_contact_person = $3,
            pickup_phone = $4,
            pickup_instructions = $5,
            updated_at = NOW()
          WHERE purchase_id = $6
        `, [
          pickupDetails.pickup_time || null,
          pickupDetails.pickup_location || null,
          pickupDetails.pickup_contact_person || null,
          pickupDetails.pickup_phone || null,
          pickupDetails.pickup_instructions || null,
          purchaseId
        ]);

        console.log(`Updated purchase order ${purchaseId} with pickup details`);
      } catch (error) {
        console.error('Error updating purchase order pickup details:', error);
      }
    }
    console.log('Registered voice WebSocket routes');
  } else {
    console.log('Warning: express-ws not initialized, WebSocket routes not available');
  }
  console.log('Registered voice routes');
}

// Chat routes with error handling
try {
  console.log('Attempting to register chat routes...');
  app.use('/api/chat', authMiddleware, chatRouter);
  console.log('Registered chat routes');
} catch (error) {
  console.error('Error registering chat routes:', error);
}

// Subagent analytics routes removed - simplified AI implementation

// Database check endpoint
app.get('/api/db-check', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    res.json({
      success: true,
      tables: result.rows.map(row => row.table_name),
      count: result.rows.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
console.log('Registered database check route at /api/db-check');

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    console.error('Environment variables check:');
    console.error('DB_HOST:', process.env.DB_HOST);
    console.error('DB_PORT:', process.env.DB_PORT);
    console.error('DB_DATABASE:', process.env.DB_DATABASE);
    console.error('DB_USER:', process.env.DB_USER);
    console.error('NODE_ENV:', process.env.NODE_ENV);
    process.exit(1);
  }
  console.log('Database connected successfully');
});

app.get('/ping', (req, res) => res.send('pong'));

// Initialize WebSocket server for voice streaming
let httpServer: any = null;
if (process.env.ENABLE_VENDOR_CALLING !== 'false') {
  try {
    console.log('WebSocket support enabled via express-ws');
  } catch (error) {
    console.error('Failed to initialize WebSocket support:', error);
  }
}

// Use the regular app for all functionality
const server = app.listen(PORT, HOST, async () => {
  console.log(`Server is running on port ${PORT}`);

  if (shouldAutoStartAiAssistant) {
    // Start AI agent automatically
    try {
      console.log('Starting AI Assistant...');
      await aiAssistantService.startAIAgent();
      console.log('AI Assistant started successfully');
    } catch (error) {
      console.error('Failed to start AI Assistant:', error);
      console.log('Server will continue without AI Assistant');
    }
  } else {
    console.log(
      'AI Assistant auto-start is disabled. Set ENABLE_AI_ASSISTANT=true to enable automatic startup.'
    );
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await aiAssistantService.stopAIAgent();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await aiAssistantService.stopAIAgent();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}); 