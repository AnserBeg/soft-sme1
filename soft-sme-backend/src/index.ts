import dotenv from 'dotenv';
import path from 'path';
import express from 'express';
import fs from 'fs';
import { spawn } from 'child_process';
import cors from 'cors';
import bodyParser from 'body-parser';
import expressWs from 'express-ws';
import cookieParser from 'cookie-parser';
import { pool } from './db';
import { authMiddleware } from './middleware/authMiddleware';
import { tenantContextMiddleware } from './middleware/tenantMiddleware';
import { requestLogger } from './middleware/requestLogger';
import { logger } from './utils/logger';
import { ACCESS_ROLES, requireAccessRoles } from './middleware/roleAccessMiddleware';

// Load environment variables - only load from .env file in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

// OCR no longer depends on Tesseract; Gemini handles image transcription.

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
import quoteTemplateRoutes from './routes/quoteTemplateRoutes';
import salesOrderRoutes from './routes/salesOrderRoutes';
import purchaseOrderRoutes from './routes/purchaseOrderRoutes';
import purchaseOrderOcrRoutes from './routes/purchaseOrderOcrRoutes';
import returnOrderRoutes from './routes/returnOrderRoutes';
import employeeRoutes from './routes/employeeRoutes';
import timeTrackingRoutes from './routes/timeTrackingRoutes';
import leaveManagementRoutes from './routes/leaveManagementRoutes';
import globalSettingsRouter from './routes/globalSettingsRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import backupRoutes from './routes/backupRoutes';
import attendanceRouter from './routes/attendanceRoutes';
import qboAuthRoutes from './routes/qboAuthRoutes';
import qboAccountRoutes from './routes/qboAccountRoutes';
import qboExportRoutes from './routes/qboExportRoutes';
import overheadRoutes from './routes/overheadRoutes';
import emailRoutes from './routes/emailRoutes';
import profileDocumentRoutes from './routes/profileDocumentRoutes';
import messagingRoutes from './routes/messagingRoutes';
import voiceRoutes from './routes/voiceRoutes';
import voiceStreamRoutes from './routes/voiceStreamRoutes';
import voiceSearchRoutes from './routes/voiceSearchRoutes';
import taskRoutes from './routes/taskRoutes';
import partFinderRoutes from './routes/partFinderRoutes';
import inventoryVendorRoutes from './routes/inventoryVendorRoutes';
import assistantRoutes from './routes/assistantRoutes';
import reminderRoutes from './routes/reminderRoutes';
import invoiceAutomatorRoutes from './routes/invoiceAutomatorRoutes';

// Add error handling around chatRouter import
let chatRouter: any;
try {
  logger.info('[Index] Attempting to import chatRouter...');
  const chatModule = require('./routes/chatRoutes');
  chatRouter = chatModule.default;
  logger.info('[Index] chatRouter imported successfully');
} catch (error) {
  logger.error('[Index] Error importing chatRouter', { err: logger.serializeError(error) });
  throw error;
}

// Subagent analytics removed - simplified AI implementation

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const HOST = process.env.HOST || '0.0.0.0';

// Initialize express-ws for WebSocket support
const wsInstance = expressWs(app);

const authWithTenantAndRole = (roles: string[]) => [
  authMiddleware,
  tenantContextMiddleware,
  requireAccessRoles(roles),
];

const adminOnly = authWithTenantAndRole([ACCESS_ROLES.ADMIN]);
const salesPurchaseAccess = authWithTenantAndRole([ACCESS_ROLES.SALES_PURCHASE]);
const timeTrackingAccess = authWithTenantAndRole([
  ACCESS_ROLES.TIME_TRACKING,
  ACCESS_ROLES.MOBILE_TIME_TRACKER,
]);
const salesOrdersAccess = authWithTenantAndRole([
  ACCESS_ROLES.SALES_PURCHASE,
  ACCESS_ROLES.TIME_TRACKING,
]);
const inventoryAccess = authWithTenantAndRole([
  ACCESS_ROLES.SALES_PURCHASE,
  ACCESS_ROLES.TIME_TRACKING,
]);
const settingsAccess = authWithTenantAndRole([
  ACCESS_ROLES.SALES_PURCHASE,
  ACCESS_ROLES.TIME_TRACKING,
]);
const messagingAccess = authWithTenantAndRole([
  ACCESS_ROLES.SALES_PURCHASE,
  ACCESS_ROLES.TIME_TRACKING,
]);
const profileDocumentsAccess = authWithTenantAndRole([
  ACCESS_ROLES.TIME_TRACKING,
  ACCESS_ROLES.MOBILE_TIME_TRACKER,
]);
const assistantAccess = authWithTenantAndRole([
  ACCESS_ROLES.SALES_PURCHASE,
  ACCESS_ROLES.TIME_TRACKING,
]);

// Request logging with request IDs
app.use(requestLogger());

const allowedOrigins = (
  [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'https://softsme.phoenixtrailers.ca',
    'https://app.aivenerp.com',
    'https://soft-sme1.onrender.com',
    'https://soft-sme-frontend.onrender.com',
    // allow test/staging Render apps
    'https://soft-smetest.onrender.com',
    'https://soft-smetest-front.onrender.com',
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

// Best-effort local assistant launcher to avoid 503s when the platform
// start command doesn't run the helper script. This is a no-op if the
// assistant is already healthy or disabled via ENABLE_AI_AGENT=0/false.
async function ensureLocalAssistant(): Promise<void> {
  const flag = (process.env.ENABLE_AI_AGENT ?? '1').toString().trim().toLowerCase();
  if (['0', 'false', 'off', 'no', 'disabled'].includes(flag)) {
    return;
  }

  const host = process.env.AI_AGENT_HOST || '127.0.0.1';
  const port = parseInt(process.env.ASSISTANT_PORT || process.env.AI_AGENT_PORT || '5001', 10);
  const healthUrl = process.env.AI_AGENT_HEALTH_URL || `http://${host}:${port}/health`;

  try {
    const r = await fetch(healthUrl);
    if (r.ok) {
      return; // already running
    }
  } catch {
    // fall through and try to start
  }

  const scriptCandidates = [
    path.resolve(__dirname, '../../Aiven.ai/assistant_server.py'),
    path.resolve(__dirname, '../Aiven.ai/assistant_server.py'),
  ];

  const scriptPath = scriptCandidates.find(p => fs.existsSync(p));
  if (!scriptPath) {
    logger.warn('[assistant] assistant_server.py not found; skipping local launch');
    return;
  }

  const userSitePaths = [
    '/opt/render/.local/lib/python3.11/site-packages',
    '/opt/render/.local/lib/python3.12/site-packages',
    '/opt/render/.local/lib/python3.13/site-packages',
    process.env.PYTHONPATH || '',
  ].filter(Boolean);

  const child = spawn('python3', ['-u', scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ASSISTANT_PORT: String(port),
      PYTHONPATH: userSitePaths.join(':'),
    },
    detached: false,
  });

  child.stdout.on('data', chunk => {
    try {
      process.stdout.write(`[assistant] ${chunk.toString()}`);
    } catch {
      /* ignore */
    }
  });
  child.stderr.on('data', chunk => {
    try {
      process.stderr.write(`[assistant] ${chunk.toString()}`);
    } catch {
      /* ignore */
    }
  });
  child.on('exit', code => {
    console.warn(`[assistant] process exited with code ${code}`);
  });
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow if no origin (non-browser) or explicitly whitelisted
    if (!origin || isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    console.warn(`[CORS] Blocked origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'x-csrf-token',
    'X-CSRF-Token',
    'x-tenant-id',
    'X-Tenant-Id',
    // Support axios/fetch cache directives from browsers and proxies
    'Cache-Control',
    'cache-control',
    'x-device-id',
    'x-timezone',
    'X-Timezone',
  ],
  optionsSuccessStatus: 204,
};

// Apply CORS early and handle preflight globally
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));
// Block TRACE/TRACK to reduce XST exposure.
app.use((req, res, next) => {
  if (req.method === 'TRACE' || req.method === 'TRACK') {
    return res.sendStatus(405);
  }
  return next();
});
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
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
app.use('/api/business-profile', adminOnly, businessProfileRoutes);
console.log('Registered business profile routes');

app.use('/api/customers', salesPurchaseAccess, customerRoutes);
console.log('Registered customer routes');

app.use('/api/products', salesPurchaseAccess, productRoutes);
console.log('Registered product routes');

app.use('/api/purchase-history', adminOnly, purchaseHistoryRoutes);
console.log('Registered purchase history routes');

app.use('/api/margin-schedule', adminOnly, marginScheduleRoutes);
console.log('Registered margin schedule routes');

app.use('/api/vendors', salesPurchaseAccess, vendorRoutes);
console.log('Registered vendor routes');

app.use('/api/inventory', inventoryAccess, inventoryRoutes);
console.log('Registered inventory routes');

// Categories
app.use('/api/categories', adminOnly, categoryRoutes);
console.log('Registered category routes');

app.use('/api/quotes', salesPurchaseAccess, quoteRoutes);
console.log('Registered quote routes');

app.use('/api/quote-templates', salesPurchaseAccess, quoteTemplateRoutes);
console.log('Registered quote template routes');

app.use('/api/sales-orders', salesOrdersAccess, salesOrderRoutes);
console.log('Registered sales order routes');

app.use('/api/purchase-orders', salesPurchaseAccess, purchaseOrderRoutes);
console.log('Registered purchase order routes');

app.use('/api/purchase-orders/ocr', salesPurchaseAccess, purchaseOrderOcrRoutes);
console.log('Registered purchase order OCR routes');

app.use('/api/return-orders', salesPurchaseAccess, returnOrderRoutes);
console.log('Registered return order routes');

app.use('/api/employees', adminOnly, employeeRoutes);
console.log('Registered employee routes');

app.use('/api/invoices', salesPurchaseAccess, invoiceRoutes);
console.log('Registered invoice routes');

app.use('/api/time-tracking', timeTrackingAccess, timeTrackingRoutes);
console.log('Registered time tracking routes');

app.use('/api/leave-management', timeTrackingAccess, leaveManagementRoutes);
console.log('Registered leave management routes');

app.use('/api/attendance', timeTrackingAccess, attendanceRouter);
console.log('Registered attendance routes');

app.use('/api/settings', settingsAccess, globalSettingsRouter);
console.log('Registered global settings routes');

app.use('/api/backup', adminOnly, backupRoutes);
console.log('Registered backup routes');

app.use('/api/qbo', qboAuthRoutes);
console.log('Registered QBO auth routes');

app.use('/api/qbo-accounts', adminOnly, qboAccountRoutes);
console.log('Registered QBO account routes');

// AI Assistant (routes to local Python sidecar)
app.use('/api/assistant', assistantAccess, assistantRoutes);
console.log('Registered AI assistant routes');

app.use('/api/qbo-export', adminOnly, qboExportRoutes);
console.log('Registered QBO export routes');

app.use('/api/overhead', adminOnly, overheadRoutes);
console.log('Registered overhead routes');

// Part Finder (SO-specific stats)
app.use('/api/part-finder', salesPurchaseAccess, partFinderRoutes);
console.log('Registered part finder routes');

// Inventory vendor mappings
app.use('/api/inventory', inventoryAccess, inventoryVendorRoutes);
console.log('Registered inventory vendor routes');

// Email routes
app.use('/api/email', salesPurchaseAccess, emailRoutes);
app.use('/api/invoice-automator', salesPurchaseAccess, invoiceAutomatorRoutes);
console.log('Registered email routes');

// Profile document routes
app.use('/api/profile-documents', profileDocumentsAccess, profileDocumentRoutes);
console.log('Registered profile document routes');

app.use('/api/messaging', messagingAccess, messagingRoutes);
console.log('Registered messaging routes');

app.use('/api/reminders', adminOnly, reminderRoutes);
console.log('Registered reminder routes');

app.use('/api/tasks', salesPurchaseAccess, taskRoutes);
console.log('Registered task routes');

// Voice/calling routes (feature flag optional)
if (process.env.ENABLE_VENDOR_CALLING !== 'false') {
  // LiveKit/Telnyx: protect routes; no Twilio webhooks here anymore
  app.use('/api/voice', adminOnly, voiceRoutes);
  // Register WebSocket routes with express-ws instance
  if (wsInstance) {
    app.use('/api/voice', adminOnly, voiceStreamRoutes);

// Voice search routes (always available)
app.use('/api/voice-search', adminOnly, voiceSearchRoutes);
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
  app.use('/api/chat', adminOnly, chatRouter);
  logger.info('Registered chat routes');
} catch (error) {
  logger.error('Error registering chat routes', { err: logger.serializeError(error) });
}

// Subagent analytics routes removed - simplified AI implementation

// Database check endpoint
app.get('/api/db-check', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
console.log('Registered database check route at /api/db-check');

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const wait = (durationMs: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, durationMs);
  });

const shouldSkipDbStartupCheck =
  (process.env.DB_SKIP_STARTUP_CHECK ?? '').trim().toLowerCase() === 'true';

const dbStartupRetryAttempts = parsePositiveInt(
  process.env.DB_STARTUP_RETRY_ATTEMPTS,
  5
);
const dbStartupRetryDelayMs = parsePositiveInt(
  process.env.DB_STARTUP_RETRY_DELAY_MS,
  5000
);

const verifyDatabaseConnection = async (): Promise<void> => {
  if (shouldSkipDbStartupCheck) {
    logger.warn('[db] Startup connectivity check skipped via DB_SKIP_STARTUP_CHECK');
    return;
  }

  for (let attempt = 1; attempt <= dbStartupRetryAttempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      logger.info(`[db] Database connection verified on attempt ${attempt}`);
      return;
    } catch (error) {
      logger.error(`[db] Database connection attempt ${attempt} failed`, { err: logger.serializeError(error) });

      if (attempt === dbStartupRetryAttempts) {
        logger.error(
          '[db] Unable to verify database connectivity after retries. The server will continue to start, but database-dependent requests may fail until the connection is restored.'
        );
        if (process.env.DATABASE_URL) {
          logger.error('[db] DATABASE_URL is configured; verify the connection string.');
        } else {
          logger.error('[db] Environment variables check:');
          logger.error('[db] DB_HOST', { value: process.env.DB_HOST });
          logger.error('[db] DB_PORT', { value: process.env.DB_PORT });
          logger.error('[db] DB_DATABASE', { value: process.env.DB_DATABASE });
          logger.error('[db] DB_USER', { value: process.env.DB_USER });
        }
        logger.error('[db] NODE_ENV', { value: process.env.NODE_ENV });
        return;
      }

      await wait(dbStartupRetryDelayMs);
    }
  }
};

pool.on('error', error => {
  logger.error('[db] Unexpected error on idle client', { err: logger.serializeError(error) });
});

app.get('/ping', (req, res) => res.send('pong'));

// Initialize WebSocket server for voice streaming
let httpServer: any = null;
if (process.env.ENABLE_VENDOR_CALLING !== 'false') {
  try {
    logger.info('WebSocket support enabled via express-ws');
  } catch (error) {
    logger.error('Failed to initialize WebSocket support', { err: logger.serializeError(error) });
  }
}

// Use the regular app for all functionality
const server = app.listen(PORT, HOST, async () => {
  logger.info(`Server is running on port ${PORT}`);

  // Try to start the local assistant in the background if not healthy
  ensureLocalAssistant().catch(err => {
    logger.warn('[assistant] failed to launch', { error: err instanceof Error ? err.message : String(err) });
  });

  await verifyDatabaseConnection();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

// Global error handlers
process.on('uncaughtException', (err) => {
  logger.fatal('uncaughtException', { err: logger.serializeError(err) });
});
process.on('unhandledRejection', (reason) => {
  logger.fatal('unhandledRejection', { err: logger.serializeError(reason as any) });
});
