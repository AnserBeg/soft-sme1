#!/usr/bin/env python3
"""
NEURATASK Documentation Vector Database Setup
============================================

This script sets up a vector database for RAG (Retrieval-Augmented Generation)
using the NEURATASK documentation files. It supports multiple vector database
options and provides a simple interface for the AI assistant to query the docs.

Requirements:
- pip install chromadb langchain-google-genai google-generativeai
- or pip install pinecone-client langchain-google-genai google-generativeai
- or pip install qdrant-client langchain-google-genai google-generativeai
"""

import os
import json
import hashlib
from typing import List, Dict, Any, Optional, Union
from pathlib import Path
import logging

from langchain_google_genai import GoogleGenerativeAIEmbeddings

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DOCS_DIR = REPO_ROOT / "docs" / "rag"

class DocumentationVectorDB:
    """Vector database for NEURATASK documentation"""
    
    def __init__(self, db_type: str = "chroma", db_path: str = "./vector_db"):
        """
        Initialize the vector database
        
        Args:
            db_type: Type of vector database ("chroma", "pinecone", "qdrant")
            db_path: Path to store the database
        """
        self.db_type = db_type
        self.db_path = db_path
        self.embedding_model = None
        self.embedding_dimension: Optional[int] = None
        self.db = None
        
        # Initialize the database
        self._initialize_db()
    
    def _initialize_db(self):
        """Initialize the vector database based on type"""
        try:
            if self.db_type == "chroma":
                self._init_chroma()
            elif self.db_type == "pinecone":
                self._init_pinecone()
            elif self.db_type == "qdrant":
                self._init_qdrant()
            else:
                raise ValueError(f"Unsupported database type: {self.db_type}")
                
            logger.info(f"Initialized {self.db_type} vector database")
            
        except ImportError as e:
            logger.error(f"Missing dependency for {self.db_type}: {e}")
            logger.info("Falling back to ChromaDB...")
            self.db_type = "chroma"
            self._init_chroma()

    def _ensure_embedding_dimension(self) -> int:
        """Determine and cache the embedding dimensionality."""

        if self.embedding_dimension is None:
            sample = self._get_embeddings(["dimension probe"])
            if not sample or not sample[0]:
                raise RuntimeError("Failed to determine embedding dimensionality from Gemini embeddings")
            self.embedding_dimension = len(sample[0])

        return self.embedding_dimension
    
    def _init_chroma(self):
        """Initialize ChromaDB"""
        try:
            import chromadb
            from chromadb.config import Settings
            
            # Ensure directory exists under backend
            Path(self.db_path).mkdir(parents=True, exist_ok=True)
            
            # Create client
            self.db = chromadb.PersistentClient(
                path=self.db_path,
                settings=Settings(anonymized_telemetry=False)
            )
            
            # Get or create collection
            self.collection = self.db.get_or_create_collection(
                name="soft_sme_docs",
                metadata={"description": "NEURATASK Application Documentation"}
            )
            
            logger.info("ChromaDB initialized successfully")
            
        except ImportError:
            logger.error("ChromaDB not installed. Install with: pip install chromadb")
            raise
    
    def _init_pinecone(self):
        """Initialize Pinecone"""
        try:
            import pinecone
            
            # Initialize Pinecone
            api_key = os.getenv("PINECONE_API_KEY")
            if not api_key:
                raise ValueError("PINECONE_API_KEY environment variable required")
            
            pinecone.init(api_key=api_key, environment=os.getenv("PINECONE_ENVIRONMENT", "us-west1-gcp"))
            
            # Create or get index
            index_name = "soft-sme-docs"
            if index_name not in pinecone.list_indexes():
                dimension = self._ensure_embedding_dimension()
                pinecone.create_index(
                    name=index_name,
                    dimension=dimension,
                    metric="cosine"
                )
            
            self.index = pinecone.Index(index_name)
            logger.info("Pinecone initialized successfully")
            
        except ImportError:
            logger.error("Pinecone not installed. Install with: pip install pinecone-client")
            raise
    
    def _init_qdrant(self):
        """Initialize Qdrant"""
        try:
            from qdrant_client import QdrantClient
            from qdrant_client.models import Distance, VectorParams
            
            # Ensure directory exists under backend
            Path(self.db_path).mkdir(parents=True, exist_ok=True)
            
            # Create client
            self.client = QdrantClient(path=self.db_path)
            
            # Create collection
            collection_name = "soft_sme_docs"
            dimension = self._ensure_embedding_dimension()
            self.client.recreate_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(size=dimension, distance=Distance.COSINE)
            )
            
            self.collection_name = collection_name
            logger.info("Qdrant initialized successfully")
            
        except ImportError:
            logger.error("Qdrant not installed. Install with: pip install qdrant-client")
            raise
    
    def _get_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for text chunks"""
        if self.embedding_model is None:
            api_key = os.getenv("GEMINI_API_KEY")
            if not api_key:
                raise ValueError("GEMINI_API_KEY environment variable required for embeddings")

            model_name = os.getenv("AI_AGENT_EMBEDDING_MODEL", "models/text-embedding-004")
            self.embedding_model = GoogleGenerativeAIEmbeddings(
                model=model_name,
                google_api_key=api_key,
            )

        embeddings = self.embedding_model.embed_documents(texts)
        return embeddings
    
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
            "sections": sections[:5],  # Limit to first 5 sections
            "file_path": file_path,
            "content_length": len(content)
        }
    
    def add_document(self, file_path: str, content: str):
        """Add a document to the vector database"""
        try:
            # Extract metadata
            metadata = self._extract_metadata(file_path, content)
            
            # Chunk the content
            chunks = self._chunk_text(content)
            
            # Generate embeddings
            embeddings = self._get_embeddings(chunks)
            
            # Generate IDs for chunks
            base_id = hashlib.md5(file_path.encode()).hexdigest()[:8]
            chunk_ids = [f"{base_id}_{i}" for i in range(len(chunks))]
            
            # Add to database based on type
            if self.db_type == "chroma":
                self._add_to_chroma(chunk_ids, chunks, embeddings, metadata)
            elif self.db_type == "pinecone":
                self._add_to_pinecone(chunk_ids, chunks, embeddings, metadata)
            elif self.db_type == "qdrant":
                self._add_to_qdrant(chunk_ids, chunks, embeddings, metadata)
            
            logger.info(f"Added {len(chunks)} chunks from {file_path}")
            
        except Exception as e:
            logger.error(f"Error adding document {file_path}: {e}")
            raise
    
    def _add_to_chroma(self, chunk_ids: List[str], chunks: List[str], 
                       embeddings: List[List[float]], metadata: Dict[str, Any]):
        """Add chunks to ChromaDB"""
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
            embeddings=embeddings,
            metadatas=chunk_metadata
        )
    
    def _add_to_pinecone(self, chunk_ids: List[str], chunks: List[str], 
                        embeddings: List[List[float]], metadata: Dict[str, Any]):
        """Add chunks to Pinecone"""
        # Prepare vectors for Pinecone
        vectors = []
        for i, (chunk_id, chunk, embedding) in enumerate(zip(chunk_ids, chunks, embeddings)):
            chunk_meta = metadata.copy()
            chunk_meta["chunk_index"] = i
            chunk_meta["chunk_id"] = chunk_id
            chunk_meta["text"] = chunk
            
            vectors.append({
                "id": chunk_id,
                "values": embedding,
                "metadata": chunk_meta
            })
        
        # Upsert in batches
        batch_size = 100
        for i in range(0, len(vectors), batch_size):
            batch = vectors[i:i + batch_size]
            self.index.upsert(vectors=batch)
    
    def _add_to_qdrant(self, chunk_ids: List[str], chunks: List[str], 
                      embeddings: List[List[float]], metadata: Dict[str, Any]):
        """Add chunks to Qdrant"""
        from qdrant_client.models import PointStruct
        
        # Prepare points for Qdrant
        points = []
        for i, (chunk_id, chunk, embedding) in enumerate(zip(chunk_ids, chunks, embeddings)):
            chunk_meta = metadata.copy()
            chunk_meta["chunk_index"] = i
            chunk_meta["chunk_id"] = chunk_id
            chunk_meta["text"] = chunk
            
            points.append(PointStruct(
                id=chunk_id,
                vector=embedding,
                payload=chunk_meta
            ))
        
        # Upsert points
        self.client.upsert(
            collection_name=self.collection_name,
            points=points
        )
    
    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Search for relevant documentation chunks"""
        try:
            # Generate query embedding
            query_embedding = self._get_embeddings([query])[0]
            
            # Search based on database type
            if self.db_type == "chroma":
                return self._search_chroma(query, query_embedding, top_k)
            elif self.db_type == "pinecone":
                return self._search_pinecone(query, query_embedding, top_k)
            elif self.db_type == "qdrant":
                return self._search_qdrant(query, query_embedding, top_k)
                
        except Exception as e:
            logger.error(f"Error searching: {e}")
            return []
    
    def _search_chroma(self, query: str, query_embedding: List[float], top_k: int) -> List[Dict[str, Any]]:
        """Search ChromaDB"""
        results = self.collection.query(
            query_embeddings=[query_embedding],
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
    
    def _search_pinecone(self, query: str, query_embedding: List[float], top_k: int) -> List[Dict[str, Any]]:
        """Search Pinecone"""
        results = self.index.query(
            vector=query_embedding,
            top_k=top_k,
            include_metadata=True
        )
        
        formatted_results = []
        for match in results.matches:
            formatted_results.append({
                "id": match.id,
                "text": match.metadata.get("text", ""),
                "metadata": match.metadata,
                "score": match.score
            })
        
        return formatted_results
    
    def _search_qdrant(self, query: str, query_embedding: List[float], top_k: int) -> List[Dict[str, Any]]:
        """Search Qdrant"""
        results = self.client.search(
            collection_name=self.collection_name,
            query_vector=query_embedding,
            limit=top_k,
            with_payload=True
        )
        
        formatted_results = []
        for result in results:
            formatted_results.append({
                "id": result.id,
                "text": result.payload.get("text", ""),
                "metadata": result.payload,
                "score": result.score
            })
        
        return formatted_results
    
    def get_stats(self) -> Dict[str, Any]:
        """Get database statistics"""
        try:
            if self.db_type == "chroma":
                count = self.collection.count()
                return {"total_chunks": count, "database_type": self.db_type}
            elif self.db_type == "pinecone":
                stats = self.index.describe_index_stats()
                return {"total_chunks": stats.total_vector_count, "database_type": self.db_type}
            elif self.db_type == "qdrant":
                info = self.client.get_collection(self.collection_name)
                return {"total_chunks": info.points_count, "database_type": self.db_type}
        except Exception as e:
            logger.error(f"Error getting stats: {e}")
            return {"error": str(e)}


def load_documentation_files(docs_dir: Union[str, Path] = DEFAULT_DOCS_DIR) -> List[Dict[str, str]]:
    """Load all documentation files from the directory"""
    docs: List[Dict[str, str]] = []
    docs_path = Path(docs_dir)

    if not docs_path.exists():
        logger.warning(f"Documentation directory not found: {docs_path}")
        return docs

    markdown_files = sorted(docs_path.rglob("*.md"))

    if not markdown_files:
        logger.warning(f"No markdown files discovered under {docs_path}")
        return docs

    for file_path in markdown_files:
        try:
            content = file_path.read_text(encoding="utf-8")
            try:
                relative_path = file_path.relative_to(REPO_ROOT)
            except ValueError:
                relative_path = file_path

            docs.append({
                "file_path": str(relative_path),
                "content": content
            })
            logger.info(f"Loaded documentation: {relative_path}")
        except Exception as e:
            logger.error(f"Error loading {file_path}: {e}")

    return docs


def setup_vector_database(db_type: str = "chroma", docs_dir: Union[str, Path] = DEFAULT_DOCS_DIR):
    """Set up the vector database with all documentation"""
    logger.info(f"Setting up {db_type} vector database...")
    
    # Initialize database
    # Store DB under backend's rag_agent/chroma_db by default
    db_path = os.path.join(os.path.dirname(__file__), 'chroma_db')
    db = DocumentationVectorDB(db_type=db_type, db_path=db_path)
    
    # Load documentation files
    docs = load_documentation_files(docs_dir)

    if not docs:
        logger.warning("No documentation was ingested into the vector database.")
    
    # Add documents to database
    for doc in docs:
        db.add_document(doc["file_path"], doc["content"])
    
    # Get and display stats
    stats = db.get_stats()
    logger.info(f"Database setup complete: {stats}")
    
    return db


def test_search(db: DocumentationVectorDB):
    """Test the search functionality"""
    test_queries = [
        "How do I create a purchase order?",
        "What is the difference between stock and supply items?",
        "How does time tracking work?",
        "How do I export to QuickBooks?",
        "What are the validation rules for sales orders?"
    ]
    
    logger.info("Testing search functionality...")
    
    for query in test_queries:
        logger.info(f"\nQuery: {query}")
        results = db.search(query, top_k=3)
        
        for i, result in enumerate(results, 1):
            logger.info(f"  {i}. {result['metadata'].get('title', 'Unknown')} (Score: {result['score']:.3f})")
            logger.info(f"     {result['text'][:100]}...")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Set up vector database for NEURATASK documentation")
    parser.add_argument("--db-type", choices=["chroma", "pinecone", "qdrant"], 
                       default="chroma", help="Vector database type")
    parser.add_argument(
        "--docs-dir",
        default=str(DEFAULT_DOCS_DIR),
        help="Directory containing documentation files"
    )
    parser.add_argument("--test", action="store_true", help="Run search tests after setup")
    
    args = parser.parse_args()
    
    # Set up the database
    db = setup_vector_database(args.db_type, args.docs_dir)
    
    # Test if requested
    if args.test:
        test_search(db)
    
    logger.info("Setup complete! You can now use the DocumentationVectorDB class in your AI assistant.")

