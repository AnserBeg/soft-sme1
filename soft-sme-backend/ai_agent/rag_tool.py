#!/usr/bin/env python3
"""
Documentation RAG Tool
=====================

RAG (Retrieval-Augmented Generation) tool for Aiven documentation.
Uses ChromaDB for vector storage and sentence-transformers for embeddings.
"""

import os
import logging
import hashlib
from typing import List, Dict, Any
from langchain.tools import BaseTool
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
import asyncio


def _ensure_hf_cache_dirs() -> None:
    """Ensure any configured Hugging Face cache directories exist."""
    cache_env_vars = (
        "TRANSFORMERS_CACHE",
        "HUGGINGFACE_HUB_CACHE",
        "HF_HOME",
    )

    for env_var in cache_env_vars:
        cache_dir = os.getenv(env_var)
        if cache_dir:
            os.makedirs(cache_dir, exist_ok=True)

    xdg_cache_home = os.getenv("XDG_CACHE_HOME")
    if xdg_cache_home:
        os.makedirs(os.path.join(xdg_cache_home, "huggingface"), exist_ok=True)

logger = logging.getLogger(__name__)

class DocumentationRAGTool(BaseTool):
    """RAG tool for Aiven documentation"""
    
    name: str = "documentation_search"
    description: str = "Search Aiven documentation for answers to user questions about features, workflows, and system usage"
    db_path: str = "./chroma_db"
    client: Any = None
    collection: Any = None
    embedding_model: Any = None
    initialized: bool = False
    
    def __init__(self, db_path: str = "./chroma_db"):
        super().__init__()
        self.db_path = db_path
        self.client = None
        self.collection = None
        self.embedding_model = None
        self.initialized = False
        
        # Initialize the tool
        self._initialize()
    
    def _initialize(self):
        """Initialize ChromaDB and embedding model"""
        try:
            # Initialize ChromaDB
            self.client = chromadb.PersistentClient(
                path=self.db_path,
                settings=Settings(anonymized_telemetry=False)
            )
            
            # Get or create collection
            self.collection = self.client.get_or_create_collection(
                name="soft_sme_docs",
                metadata={"description": "Aiven Application Documentation"}
            )
            
            # Initialize embedding model
            _ensure_hf_cache_dirs()
            self.embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
            
            self.initialized = True
            logger.info("Documentation RAG Tool initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize RAG Tool: {e}")
            raise
    
    def _chunk_text(self, text: str, chunk_size: int = 1000, overlap: int = 200) -> List[str]:
        """Split text into overlapping chunks"""
        chunks = []
        start = 0
        
        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end]
            
            # Try to break at sentence boundary
            if end < len(text):
                last_period = chunk.rfind('.')
                last_newline = chunk.rfind('\n')
                break_point = max(last_period, last_newline)
                
                if break_point > start + chunk_size // 2:
                    chunk = chunk[:break_point + 1]
                    end = start + break_point + 1
            
            chunks.append(chunk.strip())
            start = end - overlap
            
            if start >= len(text):
                break
        
        return chunks
    
    def _extract_metadata(self, file_path: str, content: str) -> Dict[str, Any]:
        """Extract metadata from documentation file"""
        filename = os.path.basename(file_path)
        
        # Extract title from first line if it's a markdown heading
        title = filename.replace('.md', '').replace('_', ' ').title()
        if content.startswith('# '):
            title = content.split('\n')[0].replace('# ', '')
        
        # Extract section headers for better context
        sections = []
        for line in content.split('\n'):
            if line.startswith('## ') and not line.startswith('###'):
                sections.append(line.replace('## ', ''))
        
        return {
            "filename": filename,
            "title": title,
            "sections": ", ".join(sections[:5]),  # Convert list to string
            "file_path": file_path,
            "content_length": len(content)
        }
    
    async def ingest_documentation(self, docs_dir: str = None):
        """Ingest documentation files into vector database"""
        try:
            if not self.initialized:
                raise Exception("RAG Tool not initialized")
            
            # Calculate the correct path to the backend directory
            if docs_dir is None:
                # Get the current file's directory (ai_agent)
                current_dir = os.path.dirname(os.path.abspath(__file__))
                # Go up to soft-sme-backend directory
                docs_dir = os.path.join(current_dir, "..")
            
            # Debug: Print current working directory and docs_dir
            logger.info(f"Current working directory: {os.getcwd()}")
            logger.info(f"Looking for documentation in: {os.path.abspath(docs_dir)}")
            
            # List of documentation files to ingest
            doc_files = [
                "PURCHASE_ORDER_SYSTEM_GUIDE.md",
                "QUOTE_SYSTEM_GUIDE.md",
                "SALES_ORDER_SYSTEM_GUIDE.md",
                "TIME_TRACKING_SYSTEM_GUIDE.md",
                "SETTINGS_SYSTEM_GUIDE.md",
                "SOFT_SME_MASTER_DOCUMENTATION.md",
                "SOFT_SME_DATABASE_STRUCTURE.md"
            ]
            
            total_chunks = 0
            
            for filename in doc_files:
                file_path = os.path.join(docs_dir, filename)
                logger.info(f"Looking for file: {os.path.abspath(file_path)}")
                if os.path.exists(file_path):
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                        
                        # Extract metadata
                        metadata = self._extract_metadata(file_path, content)
                        
                        # Chunk the content
                        chunks = self._chunk_text(content)
                        
                        # Generate embeddings
                        embeddings = self.embedding_model.encode(chunks)
                        
                        # Generate IDs for chunks
                        base_id = hashlib.md5(file_path.encode()).hexdigest()[:8]
                        chunk_ids = [f"{base_id}_{i}" for i in range(len(chunks))]
                        
                        # Prepare metadata for each chunk
                        chunk_metadata = []
                        for i, chunk in enumerate(chunks):
                            chunk_meta = metadata.copy()
                            chunk_meta["chunk_index"] = i
                            chunk_meta["chunk_id"] = chunk_ids[i]
                            chunk_metadata.append(chunk_meta)
                        
                        # Add to collection
                        self.collection.add(
                            ids=chunk_ids,
                            documents=chunks,
                            embeddings=embeddings.tolist(),
                            metadatas=chunk_metadata
                        )
                        
                        total_chunks += len(chunks)
                        logger.info(f"Ingested {len(chunks)} chunks from {filename}")
                        
                    except Exception as e:
                        logger.error(f"Error ingesting {filename}: {e}")
                else:
                    logger.warning(f"Documentation file not found: {filename}")
            
            logger.info(f"Documentation ingestion completed. Total chunks: {total_chunks}")
            
        except Exception as e:
            logger.error(f"Documentation ingestion failed: {e}")
            raise
    
    def _run(self, query: str) -> str:
        """Execute RAG search (synchronous version)"""
        try:
            if not self.initialized:
                return "RAG Tool not initialized"
            
            logger.info(f"RAG _run called with query: '{query}'")
            
            # Generate query embedding
            query_embedding = self.embedding_model.encode([query])
            
            # Search ChromaDB
            results = self.collection.query(
                query_embeddings=query_embedding.tolist(),
                n_results=5,
                include=["documents", "metadatas", "distances"]
            )
            
            if not results["documents"][0]:
                return "No relevant documentation found for this query."
            
            # Debug: Log search results
            logger.info(f"RAG search for '{query}' returned {len(results['documents'][0])} results")
            logger.info(f"Query length: {len(query)} characters")
            logger.info(f"First result preview: {results['documents'][0][0][:200]}...")
            
            # Format results
            context_parts = []
            for i, (doc, metadata, distance) in enumerate(zip(
                results["documents"][0],
                results["metadatas"][0],
                results["distances"][0]
            )):
                similarity = 1 - distance
                logger.info(f"Result {i+1}: similarity={similarity:.3f}, source={metadata.get('title', 'Unknown')}")
                
                if similarity < -0.4:  # Lowered threshold much further to -0.4 to catch negative similarities
                    logger.info(f"Skipping result {i+1} due to low similarity ({similarity:.3f})")
                    continue
                
                source = metadata.get("title", "Unknown")
                context_parts.append(f"Source {i+1} ({source}):\n{doc}\n")
            
            if not context_parts:
                logger.warning(f"No results met similarity threshold for query: '{query}'")
                return "No relevant documentation found for this query."
            
            logger.info(f"Returning {len(context_parts)} relevant results for query: '{query}'")
            return "\n".join(context_parts)
            
        except Exception as e:
            logger.error(f"RAG search error: {e}")
            return f"Error searching documentation: {str(e)}"
    
    async def _arun(self, query: str) -> str:
        """Execute RAG search (asynchronous version)"""
        # Run the synchronous version in a thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._run, query)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get RAG tool statistics"""
        try:
            if not self.initialized:
                return {"error": "RAG Tool not initialized"}
            
            count = self.collection.count()
            return {
                "total_chunks": count,
                "database_type": "chromadb",
                "embedding_model": "all-MiniLM-L6-v2"
            }
        except Exception as e:
            logger.error(f"Error getting RAG stats: {e}")
            return {"error": str(e)}
    
    def search_with_metadata(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Search with detailed metadata"""
        try:
            if not self.initialized:
                return []
            
            # Generate query embedding
            query_embedding = self.embedding_model.encode([query])
            
            # Search ChromaDB
            results = self.collection.query(
                query_embeddings=query_embedding.tolist(),
                n_results=top_k,
                include=["documents", "metadatas", "distances"]
            )
            
            formatted_results = []
            for i in range(len(results["ids"][0])):
                formatted_results.append({
                    "id": results["ids"][0][i],
                    "text": results["documents"][0][i],
                    "metadata": results["metadatas"][0][i],
                    "score": 1 - results["distances"][0][i]  # Convert distance to similarity
                })
            
            return formatted_results
            
        except Exception as e:
            logger.error(f"Search with metadata error: {e}")
            return [] 