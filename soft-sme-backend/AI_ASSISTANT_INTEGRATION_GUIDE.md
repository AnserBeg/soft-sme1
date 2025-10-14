# Aiven AI Assistant Integration Guide

## Overview

The Aiven AI Assistant is a comprehensive AI system integrated directly into the backend that provides:

1. **Documentation Q&A**: Answers questions about Aiven features using RAG (Retrieval-Augmented Generation)
2. **Live Data Queries**: Retrieves real-time inventory and order data from the database
3. **Intelligent Routing**: Automatically routes queries to the appropriate tool
4. **Conversation Management**: Maintains context across chat sessions

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │   AI Pipeline   │
│   (Electron/    │◄──►│   (Node.js/     │◄──►│   (LangGraph/   │
│    React)       │    │    Express)     │    │    Python)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Chat UI       │    │   Express API   │    │   AI Agent      │
│   Components    │    │   Routes        │    │   (Child Process│
│                 │    │                 │    │    or HTTP)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                │                       │
                                ▼                       ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   PostgreSQL    │    │   ChromaDB      │
                       │   (pgvector)    │    │   (Documentation│
                       │   (Live Data)   │    │    Vectors)     │
                       └─────────────────┘    └─────────────────┘
```

## Quick Setup

### 1. Install Dependencies

```bash
# Navigate to the AI agent directory
cd soft-sme-backend/ai_agent

# Install Python dependencies
pip install -r requirements.txt
```

### 2. Environment Configuration

Add the following to your `.env` file:

```env
# AI Assistant Configuration
AI_AGENT_MODE=local
AI_AGENT_ENDPOINT=http://localhost:5000
AI_AGENT_PORT=5000
AI_AGENT_HOST=127.0.0.1
PYTHON_PATH=python

# Remote mode authentication (optional)
# Use when AI_AGENT_MODE=remote and the service requires authorization
# Provide either a full Bearer token or the raw token (Bearer will be added automatically)
AI_AGENT_SERVICE_TOKEN=
# For services that expect an x-api-key header instead of Authorization
AI_AGENT_SERVICE_API_KEY=

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini

# Database Configuration (for SQL queries)
DB_HOST=localhost
DB_NAME=soft_sme
DB_USER=postgres
DB_PASSWORD=your_password
DB_PORT=5432

# Optional: Vector Database Configuration
CHROMA_DB_PATH=./ai_agent/chroma_db
```

#### Environment Variable Reference

Use the table below if you just need a quick reminder of which variables
to set:

| Variable | When to set it | What it does |
| --- | --- | --- |
| `AI_AGENT_MODE` | Always | `local` uses the bundled Python process, `remote` sends requests to an external service |
| `AI_AGENT_ENDPOINT` | Remote mode | Base URL of the remote AI service (e.g. `https://my-ai-service.example.com`) |
| `AI_AGENT_REMOTE_URL` | Remote mode | Explicit override for the remote chat endpoint. You can supply either the base path or the full `/chat` URL from the external service. |
| `AI_AGENT_PORT` | Local mode | Port for the local Python agent to listen on |
| `AI_AGENT_HOST` | Local mode | Hostname for the local Python agent |
| `AI_AGENT_SERVICE_TOKEN` | Remote mode (when the remote service expects a Bearer token) | Token that will be sent in the `Authorization` header. You can paste the full `Bearer <token>` value or just the token string |
| `AI_AGENT_SERVICE_API_KEY` | Remote mode (when the remote service expects an `x-api-key` header) | API key value that will be injected into the `x-api-key` header |
| `OPENAI_API_KEY` | When using OpenAI tools | API key used by the assistant for OpenAI calls |
| Database variables (`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`) | When live data queries are enabled | Connection settings for the Postgres database |
| `CHROMA_DB_PATH` | Optional | Filesystem path for the local Chroma vector store |

> **Tip:** In most setups you either set `AI_AGENT_SERVICE_TOKEN` **or**
> `AI_AGENT_SERVICE_API_KEY`—only configure the one that matches your
> remote service authentication requirements.
>
> **Gotcha Avoided:** The backend automatically trims surrounding quotes
> from `AI_AGENT_SERVICE_TOKEN`/`AI_AGENT_SERVICE_API_KEY`, so values copied
> from dashboards that include `"` characters will still match incoming
> headers.

> **Note:** When using `AI_AGENT_REMOTE_URL`, the backend will automatically
> trim a trailing `/chat` segment so you can paste the exact endpoint URL
> from your external service without additional formatting.

When you rely on an API key (for example, using a Gemini key provided via
`AI_AGENT_SERVICE_API_KEY`), make sure the remote caller sends it in the
`x-api-key` header. The backend's authentication middleware will accept
that header and skip the normal JWT session validation for trusted
service-to-service calls.

### 3. Run Setup Script

**Windows:**
```cmd
setup_ai_assistant.bat
```

**Unix/Linux:**
```bash
chmod +x setup_ai_assistant.sh
./setup_ai_assistant.sh
```

### 4. Start the Backend

The AI agent will start automatically when the main backend starts:

```bash
npm run dev
```

## API Endpoints

### Chat Endpoints

- `POST /api/ai-assistant/chat` - Send a message to the AI assistant
- `GET /api/ai-assistant/health` - Check AI assistant health
- `POST /api/ai-assistant/initialize` - Initialize the AI agent
- `GET /api/ai-assistant/conversation/:id` - Get conversation history
- `DELETE /api/ai-assistant/conversation/:id` - Clear conversation
- `GET /api/ai-assistant/stats` - Get AI assistant statistics

### Admin Endpoints

- `POST /api/ai-assistant/start` - Start AI agent (admin only)
- `POST /api/ai-assistant/stop` - Stop AI agent (admin only)

## Database Persistence and Migrations

The AI assistant now stores all conversations and follow-up jobs in PostgreSQL tables so that restarts do not erase context and
background workers can operate on a shared queue. The migration `20250315_create_ai_assistant_tables.sql` creates the following tables:

- **`ai_conversations`** – Conversation metadata (user, timestamps, status, metadata JSON).
- **`ai_messages`** – Individual chat turns linked to a conversation.
- **`ai_task_queue`** – Scheduled follow-up jobs requested by the agent.

Apply the migration with `psql` or pgAdmin before deploying:

```bash
psql "$DATABASE_URL" -f migrations/20250315_create_ai_assistant_tables.sql
```

Restart the Node.js backend and Python agent after migrating so they reconnect using the new schema.

## Background Task Worker

When the agent needs to run a follow-up action it can enqueue a job (for example to call `AgentToolsV2`). The worker in
`src/workers/aiTaskWorker.ts` polls `ai_task_queue`, invokes the requested tool, and posts success/failure summaries back into the
originating conversation. Start the worker alongside the API (e.g. `ts-node src/workers/aiTaskWorker.ts` or via your process manager)
to process queued tasks continuously.

## Usage Examples

### Frontend Integration

```typescript
import { chatService } from '../services/chatService';

// Send a message
const response = await chatService.sendMessage("How do I create a purchase order?");

console.log(response);
// {
//   response: "Based on the Aiven documentation...",
//   sources: ["documentation"],
//   confidence: 0.85,
//   toolUsed: "documentation_search",
//   timestamp: "2024-01-01T12:00:00Z"
// }

// Get conversation history
const history = await chatService.getConversationHistory(conversationId);

// Clear conversation
await chatService.clearConversation(conversationId);
```

### Direct API Calls

```bash
# Send a message
curl -X POST http://localhost:3001/api/ai-assistant/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"message": "How many units of part ABC are available?"}'

# Check health
curl -X GET http://localhost:3001/api/ai-assistant/health \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Features

### 1. Documentation Q&A

The AI assistant can answer questions about:
- How to use Aiven features
- Workflow processes
- Button functions and locations
- System configuration
- Business rules and validation

**Example Queries:**
- "How do I create a purchase order?"
- "What are the validation rules for sales orders?"
- "How does time tracking work?"
- "What are the global settings available?"

### 2. Live Data Queries

The AI assistant can retrieve real-time data about:
- Current inventory levels
- Recent orders
- Customer information
- Sales data
- Time tracking records

**Example Queries:**
- "How many units of part ABC are available?"
- "Show me recent sales orders"
- "What's my current inventory value?"
- "List customers who ordered this month"

### 3. Intelligent Routing

The system automatically determines whether to:
- Search documentation (for how-to questions)
- Query the database (for data requests)
- Use both tools (for complex queries)

### 4. Conversation Management

- Maintains context across multiple messages
- Supports follow-up questions
- Stores conversation history
- Allows conversation clearing

## Configuration Options

### AI Agent Modes

1. **Local Mode** (`AI_AGENT_MODE=local`): Runs as a child process of the main backend
2. **Remote Mode** (`AI_AGENT_MODE=remote`): Connects to a separate AI agent server

> ℹ️ **Remote Mode Tip**: Ensure `AI_AGENT_SERVICE_TOKEN` or `AI_AGENT_SERVICE_API_KEY` is set so the backend can authenticate with the remote AI agent. Without one of these values the remote server will reject requests with `401 Unauthorized`.

### Vector Database Options

- **ChromaDB** (default): Local vector database for documentation
- **Pinecone**: Cloud-based vector database (requires API key)
- **Qdrant**: Local or cloud vector database

### Embedding Models

- **all-MiniLM-L6-v2** (default): Fast, local embeddings
- **text-embedding-3-large**: OpenAI embeddings (requires API key)

## Troubleshooting

### Common Issues

1. **AI Agent Not Starting**
   - Check Python dependencies are installed
   - Verify environment variables are set
   - Check logs for specific error messages

2. **Database Connection Issues**
   - Verify database credentials in `.env`
   - Ensure PostgreSQL is running
   - Check network connectivity

3. **OpenAI API Errors**
   - Verify API key is valid
   - Check API quota and billing
   - Ensure model name is correct

4. **Vector Database Issues**
   - Check ChromaDB installation
   - Verify documentation files exist
   - Re-run documentation ingestion

### Debug Commands

```bash
# Test AI agent directly
cd ai_agent
python main.py --test

# Check Python dependencies
pip list | grep -E "(langgraph|chromadb|sentence-transformers)"

# Test database connection
python -c "import psycopg2; print('Database connection OK')"

# Check environment variables
python -c "import os; print('OPENAI_API_KEY:', bool(os.getenv('OPENAI_API_KEY')))"
```

### Logs

AI agent logs are available in:
- Backend console output
- Python process stdout/stderr
- FastAPI logs (if running standalone)

## Performance Optimization

### Memory Usage

- Limit conversation history (default: 50 messages per conversation)
- Clean up old conversations automatically
- Use efficient embedding models

### Response Time

- Cache frequently accessed documentation
- Optimize SQL queries
- Use appropriate chunk sizes for RAG

### Scalability

- Consider Redis for conversation storage
- Use cloud vector databases for large datasets
- Implement rate limiting for API endpoints

## Security Considerations

### Data Protection

- All database queries are read-only
- SQL injection protection through validation
- User authentication required for all endpoints

### API Security

- JWT token validation
- Rate limiting on endpoints
- Input sanitization

### Privacy

- Conversation data stored in memory (not persisted by default)
- No sensitive data in logs
- Optional conversation export/import

## Future Enhancements

### Planned Features

1. **Analytics Dashboard**: Usage statistics and insights
2. **Custom Training**: Train on company-specific data
3. **Multi-language Support**: Support for multiple languages
4. **Voice Integration**: Voice-to-text and text-to-speech
5. **Advanced Analytics**: Predictive insights and recommendations

### Integration Points

1. **Email Integration**: Send reports via email
2. **Slack/Teams**: Chat integration
3. **Mobile App**: Native mobile support
4. **API Gateway**: External API access

## Support

For issues and questions:
1. Check the troubleshooting section above
2. Review logs for error messages
3. Test individual components
4. Contact the development team

## License

This AI assistant is part of the Aiven application and follows the same licensing terms. 