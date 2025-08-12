# SOFT SME RAG Implementation Guide

## Overview

This guide explains how to set up and use a Retrieval-Augmented Generation (RAG) system for the SOFT SME application documentation. The RAG system allows your AI assistant to provide accurate, context-aware responses based on the comprehensive documentation we've created.

## What is RAG?

RAG (Retrieval-Augmented Generation) is a technique that combines:
1. **Retrieval**: Finding relevant information from a knowledge base
2. **Augmentation**: Adding that information to the AI's context
3. **Generation**: Creating responses based on the augmented context

This ensures your AI assistant can provide accurate, up-to-date information based on your actual documentation.

## Files Created

### Core RAG System
- `rag_documentation_setup.py` - Main vector database setup and management
- `ai_assistant_rag_integration.py` - Integration with AI assistant
- `requirements_rag.txt` - Python dependencies
- `setup_rag_system.bat` - Windows setup script

### Documentation Files (Vectorized)
- `PURCHASE_ORDER_SYSTEM_GUIDE.md`
- `QUOTE_SYSTEM_GUIDE.md`
- `SALES_ORDER_SYSTEM_GUIDE.md`
- `TIME_TRACKING_SYSTEM_GUIDE.md`
- `SETTINGS_SYSTEM_GUIDE.md`
- `SOFT_SME_MASTER_DOCUMENTATION.md`

## Quick Setup

### Option 1: Windows (Recommended)
```bash
# Run the setup script
setup_rag_system.bat
```

### Option 2: Manual Setup
```bash
# 1. Install dependencies
pip install -r requirements_rag.txt

# 2. Set up vector database
python rag_documentation_setup.py --test

# 3. Test the system
python ai_assistant_rag_integration.py --demo
```

## Vector Database Options

The system supports three vector database options:

### 1. ChromaDB (Default - Recommended)
- **Pros**: Local storage, no API keys needed, easy setup
- **Cons**: Limited scalability for very large datasets
- **Best for**: Development and small to medium deployments

### 2. Pinecone
- **Pros**: Cloud-based, highly scalable, production-ready
- **Cons**: Requires API key, costs money for large usage
- **Best for**: Production deployments with high traffic

### 3. Qdrant
- **Pros**: High performance, flexible, open-source
- **Cons**: More complex setup
- **Best for**: Advanced users who need custom configurations

## Usage Examples

### 1. Interactive Mode
```bash
python ai_assistant_rag_integration.py --interactive
```

This starts an interactive session where you can ask questions about the SOFT SME system.

### 2. Single Question
```bash
python ai_assistant_rag_integration.py --question "How do I create a purchase order?"
```

### 3. Demo Mode
```bash
python ai_assistant_rag_integration.py --demo
```

Shows example questions and their retrieved context.

## Integration with Your AI Assistant

### Basic Integration

```python
from rag_documentation_setup import DocumentationVectorDB

# Initialize the vector database
db = DocumentationVectorDB(db_type="chroma")

# Search for relevant documentation
results = db.search("How do I create a purchase order?", top_k=5)

# Use the results in your AI assistant
for result in results:
    print(f"Source: {result['metadata']['title']}")
    print(f"Content: {result['text']}")
    print(f"Confidence: {result['score']}")
```

### Advanced Integration with Context

```python
from ai_assistant_rag_integration import AIAssistantRAG

# Initialize RAG-enabled assistant
rag = AIAssistantRAG()

# Get context for a question
context = rag.get_relevant_context("How do I export to QuickBooks?")

# Use this context in your AI prompt
ai_prompt = f"""
You are an expert AI assistant for the SOFT SME application.

Context from documentation:
{context}

User question: How do I export to QuickBooks?

Please provide a comprehensive answer based on the documentation above.
"""
```

### Integration with Your Existing AI Service

```python
# In your aiService.ts or similar
import { AIAssistantRAG } from './ai_assistant_rag_integration';

class AIService {
    private rag: AIAssistantRAG;
    
    constructor() {
        this.rag = new AIAssistantRAG();
    }
    
    async sendMessage(message: string, userId?: number): Promise<string> {
        // Get relevant context from documentation
        const context = this.rag.get_relevant_context(message);
        
        // Create enhanced prompt with context
        const enhancedPrompt = `
You are an expert AI assistant in inventory management in the SOFT SME application.

Relevant documentation context:
${context}

User question: ${message}

Please provide a comprehensive answer based on the documentation above. If the documentation doesn't cover the specific question, acknowledge this and provide general guidance.
`;
        
        // Send to your AI model (Gemini, etc.)
        return await this.callAIModel(enhancedPrompt);
    }
}
```

## Sample Questions the System Can Answer

### Purchase Orders
- "How do I create a purchase order?"
- "What is the difference between stock and supply items?"
- "How does the allocation system work?"
- "What are the validation rules for purchase orders?"

### Sales Orders
- "How do I create a sales order?"
- "What are the parts to order system?"
- "Why can't I close my sales order?"
- "How do I export sales orders to QuickBooks?"

### Quotes
- "How do I create a quote?"
- "How do I convert a quote to a sales order?"
- "What information is required for quotes?"

### Time Tracking
- "How does time tracking work?"
- "How do I clock in and out?"
- "How are labour rates calculated?"
- "How does time tracking integrate with sales orders?"

### Settings & Configuration
- "How do I set up QuickBooks integration?"
- "What are the global settings available?"
- "How do I manage the business profile?"
- "How do I backup the system?"

### General System
- "What are the business rules for the system?"
- "How do I manage customers?"
- "What validation rules exist?"
- "How does the database structure work?"

## Database Management

### Viewing Statistics
```python
from rag_documentation_setup import DocumentationVectorDB

db = DocumentationVectorDB()
stats = db.get_stats()
print(f"Total chunks: {stats['total_chunks']}")
print(f"Database type: {stats['database_type']}")
```

### Adding New Documentation
```python
# Add a new documentation file
db.add_document("path/to/new_doc.md", content)
```

### Updating Existing Documentation
```python
# The system will automatically handle updates
# Just re-run the setup script with the updated files
python rag_documentation_setup.py
```

## Performance Optimization

### Chunk Size Tuning
```python
# In rag_documentation_setup.py, modify the chunk_size parameter
chunks = self._chunk_text(content, chunk_size=800, overlap=150)
```

### Search Parameters
```python
# Adjust top_k for more or fewer results
results = db.search(query, top_k=10)  # Get more results
results = db.search(query, top_k=3)   # Get fewer results
```

### Confidence Thresholds
```python
# Filter out low-confidence results
filtered_results = [r for r in results if r['score'] >= 0.3]
```

## Troubleshooting

### Common Issues

1. **Import Errors**
   ```bash
   pip install chromadb sentence-transformers
   ```

2. **Memory Issues**
   - Reduce chunk size in `_chunk_text()`
   - Use smaller embedding model
   - Process documents in batches

3. **Slow Performance**
   - Use Pinecone for cloud-based performance
   - Optimize chunk size and overlap
   - Use faster embedding models

4. **Low Quality Results**
   - Increase `top_k` parameter
   - Lower confidence threshold
   - Improve chunking strategy

### Debug Mode
```python
import logging
logging.basicConfig(level=logging.DEBUG)

# This will show detailed information about the RAG process
```

## Best Practices

### 1. Regular Updates
- Update the vector database when documentation changes
- Re-run setup script after major documentation updates

### 2. Quality Control
- Monitor confidence scores
- Review retrieved context for accuracy
- Adjust search parameters based on results

### 3. Performance Monitoring
- Track query response times
- Monitor database size
- Optimize based on usage patterns

### 4. User Experience
- Provide source attribution in responses
- Include confidence scores when appropriate
- Handle cases where no relevant documentation is found

## Advanced Features

### Custom Embedding Models
```python
# Use different embedding models
from sentence_transformers import SentenceTransformer

# For better performance
model = SentenceTransformer('all-mpnet-base-v2')

# For faster processing
model = SentenceTransformer('all-MiniLM-L6-v2')
```

### Hybrid Search
```python
# Combine semantic and keyword search
def hybrid_search(query, top_k=5):
    # Semantic search
    semantic_results = db.search(query, top_k)
    
    # Keyword search (implement as needed)
    keyword_results = keyword_search(query, top_k)
    
    # Combine and rank results
    return combine_results(semantic_results, keyword_results)
```

### Multi-Modal Support
```python
# Extend for image/document processing
def add_document_with_images(file_path, content, images):
    # Process text content
    text_chunks = self._chunk_text(content)
    
    # Process images (if needed)
    image_embeddings = self._process_images(images)
    
    # Combine and store
    self._add_multimodal_chunks(text_chunks, image_embeddings)
```

## Conclusion

This RAG system provides a powerful foundation for making your AI assistant knowledgeable about the SOFT SME application. By following this guide, you can:

1. Set up a robust vector database
2. Integrate it with your AI assistant
3. Provide accurate, context-aware responses
4. Scale the system as your documentation grows

The system is designed to be flexible and can be adapted to your specific needs. Start with the basic setup and gradually add advanced features as needed. 