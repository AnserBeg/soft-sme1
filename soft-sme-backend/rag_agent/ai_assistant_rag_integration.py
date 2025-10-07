#!/usr/bin/env python3
"""
AI Assistant RAG Integration
============================

This script shows how to integrate the vector database with your AI assistant
to provide context-aware responses based on the NEURATASK documentation.

Usage:
1. First run: python rag_documentation_setup.py --test
2. Then use this script to query the documentation
"""

import os
import json
from typing import List, Dict, Any
from rag_documentation_setup import DocumentationVectorDB


class AIAssistantRAG:
    """RAG-enabled AI Assistant for NEURATASK"""
    
    def __init__(self, db_type: str = "chroma", db_path: str = "./vector_db"):
        """Initialize the RAG-enabled assistant"""
        self.db = DocumentationVectorDB(db_type=db_type, db_path=db_path)
        self.context_window = 3000  # Maximum context length for AI
    
    def get_relevant_context(self, query: str, top_k: int = 5) -> str:
        """Get relevant documentation context for a query"""
        try:
            # Search for relevant documentation chunks
            results = self.db.search(query, top_k=top_k)
            
            if not results:
                return "No relevant documentation found for this query."
            
            # Build context from search results
            context_parts = []
            total_length = 0
            
            for i, result in enumerate(results, 1):
                # Skip low-quality results
                if result['score'] < 0.3:
                    continue
                
                # Format the context
                metadata = result['metadata']
                title = metadata.get('title', 'Unknown')
                filename = metadata.get('filename', 'Unknown')
                
                context_part = f"""
--- Source {i}: {title} ({filename}) ---
{result['text']}
"""
                
                # Check if adding this would exceed context window
                if total_length + len(context_part) > self.context_window:
                    break
                
                context_parts.append(context_part)
                total_length += len(context_part)
            
            if not context_parts:
                return "No relevant documentation found for this query."
            
            # Combine all context parts
            full_context = "\n".join(context_parts)
            
            return f"""
Based on the NEURATASK documentation, here is relevant information:

{full_context}

Please use this information to answer the user's question accurately and comprehensively.
"""
            
        except Exception as e:
            return f"Error retrieving documentation context: {str(e)}"
    
    def answer_question(self, question: str, include_context: bool = True) -> Dict[str, Any]:
        """Answer a question using RAG"""
        try:
            # Get relevant context
            context = self.get_relevant_context(question) if include_context else ""
            
            # Prepare response structure
            response = {
                "question": question,
                "context": context,
                "answer": "",
                "sources": [],
                "confidence": 0.0
            }
            
            # Extract source information
            results = self.db.search(question, top_k=3)
            for result in results:
                if result['score'] >= 0.3:  # Only include high-confidence sources
                    response["sources"].append({
                        "title": result['metadata'].get('title', 'Unknown'),
                        "filename": result['metadata'].get('filename', 'Unknown'),
                        "score": result['score']
                    })
            
            # Calculate overall confidence
            if response["sources"]:
                response["confidence"] = sum(s["score"] for s in response["sources"]) / len(response["sources"])
            
            return response
            
        except Exception as e:
            return {
                "question": question,
                "context": "",
                "answer": f"Error processing question: {str(e)}",
                "sources": [],
                "confidence": 0.0
            }
    
    def get_documentation_summary(self) -> Dict[str, Any]:
        """Get a summary of available documentation"""
        try:
            stats = self.db.get_stats()
            
            # Get sample queries to show what the system can answer
            sample_queries = [
                "How do I create a purchase order?",
                "What is the difference between stock and supply items?",
                "How does time tracking work?",
                "How do I export to QuickBooks?",
                "What are the validation rules for sales orders?",
                "How do I manage customer information?",
                "What are the business rules for closing sales orders?",
                "How does the allocation system work?",
                "What are the global settings available?",
                "How do I backup the system?"
            ]
            
            return {
                "database_stats": stats,
                "available_topics": [
                    "Purchase Order Management",
                    "Sales Order Processing", 
                    "Quote System",
                    "Time Tracking",
                    "Settings & Configuration",
                    "Customer Management",
                    "Inventory Management",
                    "QuickBooks Integration",
                    "Business Rules & Validation",
                    "System Administration"
                ],
                "sample_queries": sample_queries,
                "documentation_files": [
                    "PURCHASE_ORDER_SYSTEM_GUIDE.md",
                    "QUOTE_SYSTEM_GUIDE.md",
                    "SALES_ORDER_SYSTEM_GUIDE.md", 
                    "TIME_TRACKING_SYSTEM_GUIDE.md",
                    "SETTINGS_SYSTEM_GUIDE.md",
                    "SOFT_SME_MASTER_DOCUMENTATION.md"
                ]
            }
            
        except Exception as e:
            return {"error": f"Error getting documentation summary: {str(e)}"}


def demo_rag_system():
    """Demonstrate the RAG system functionality"""
    print("NEURATASK AI Assistant RAG Demo")
    print("=" * 50)
    
    # Initialize the RAG system
    rag = AIAssistantRAG()
    
    # Get documentation summary
    print("\n1. Documentation Summary:")
    summary = rag.get_documentation_summary()
    print(f"Database Stats: {summary['database_stats']}")
    print(f"Available Topics: {len(summary['available_topics'])}")
    
    # Demo questions
    demo_questions = [
        "How do I create a purchase order?",
        "What is the difference between stock and supply items?",
        "How does time tracking work?",
        "What are the validation rules for sales orders?",
        "How do I export to QuickBooks?"
    ]
    
    print("\n2. Demo Questions and Context:")
    for i, question in enumerate(demo_questions, 1):
        print(f"\n--- Question {i}: {question} ---")
        
        # Get answer with context
        response = rag.answer_question(question)
        
        print(f"Confidence: {response['confidence']:.3f}")
        print(f"Sources: {len(response['sources'])}")
        
        # Show context (truncated)
        context = response['context']
        if len(context) > 500:
            context = context[:500] + "..."
        print(f"Context: {context}")
        
        # Show sources
        for source in response['sources']:
            print(f"  - {source['title']} (Score: {source['score']:.3f})")


def interactive_mode():
    """Interactive mode for testing the RAG system"""
    print("NEURATASK AI Assistant - Interactive Mode")
    print("Type 'quit' to exit, 'help' for available commands")
    print("=" * 50)
    
    rag = AIAssistantRAG()
    
    while True:
        try:
            question = input("\nEnter your question: ").strip()
            
            if question.lower() in ['quit', 'exit', 'q']:
                print("Goodbye!")
                break
            elif question.lower() == 'help':
                print("\nAvailable commands:")
                print("  help - Show this help")
                print("  summary - Show documentation summary")
                print("  stats - Show database statistics")
                print("  quit - Exit the program")
                print("\nOr ask any question about the NEURATASK system!")
                continue
            elif question.lower() == 'summary':
                summary = rag.get_documentation_summary()
                print(f"\nDocumentation Summary:")
                print(f"Database: {summary['database_stats']}")
                print(f"Topics: {', '.join(summary['available_topics'])}")
                continue
            elif question.lower() == 'stats':
                stats = rag.db.get_stats()
                print(f"\nDatabase Statistics: {stats}")
                continue
            elif not question:
                continue
            
            # Get answer
            print("\nSearching documentation...")
            response = rag.answer_question(question)
            
            print(f"\nConfidence: {response['confidence']:.3f}")
            print(f"Sources: {len(response['sources'])}")
            
            # Show context
            print(f"\nContext:")
            print(response['context'])
            
            # Show sources
            if response['sources']:
                print(f"\nSources:")
                for source in response['sources']:
                    print(f"  - {source['title']} (Score: {source['score']:.3f})")
            
        except KeyboardInterrupt:
            print("\nGoodbye!")
            break
        except Exception as e:
            print(f"Error: {e}")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="NEURATASK AI Assistant RAG Integration")
    parser.add_argument("--demo", action="store_true", help="Run demo mode")
    parser.add_argument("--interactive", action="store_true", help="Run interactive mode")
    parser.add_argument("--question", type=str, help="Ask a specific question")
    
    args = parser.parse_args()
    
    if args.demo:
        demo_rag_system()
    elif args.interactive:
        interactive_mode()
    elif args.question:
        rag = AIAssistantRAG()
        response = rag.answer_question(args.question)
        print(f"Question: {response['question']}")
        print(f"Confidence: {response['confidence']:.3f}")
        print(f"Context: {response['context']}")
    else:
        print("Use --demo, --interactive, or --question to run the RAG system")
        print("Example: python ai_assistant_rag_integration.py --demo")

