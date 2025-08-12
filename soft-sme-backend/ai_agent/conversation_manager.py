#!/usr/bin/env python3
"""
Conversation Manager
===================

Manages conversation history and context for the AI assistant.
Provides in-memory storage with optional persistence.
"""

import uuid
import time
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class ConversationManager:
    """Manages conversation history and context"""
    
    def __init__(self, max_conversations: int = 1000, max_messages_per_conversation: int = 50):
        self.conversations: Dict[str, Dict[str, Any]] = {}
        self.max_conversations = max_conversations
        self.max_messages_per_conversation = max_messages_per_conversation
        
        # Statistics
        self.stats = {
            "total_conversations": 0,
            "total_messages": 0,
            "active_conversations": 0
        }
    
    def create_conversation(self, user_id: Optional[int] = None) -> str:
        """Create a new conversation"""
        conversation_id = str(uuid.uuid4())
        
        self.conversations[conversation_id] = {
            "id": conversation_id,
            "user_id": user_id,
            "created_at": datetime.now(),
            "updated_at": datetime.now(),
            "messages": [],
            "metadata": {}
        }
        
        # Update statistics
        self.stats["total_conversations"] += 1
        self.stats["active_conversations"] += 1
        
        # Cleanup old conversations if needed
        self._cleanup_old_conversations()
        
        logger.info(f"Created conversation {conversation_id} for user {user_id}")
        return conversation_id
    
    def add_message(self, conversation_id: str, message: str, is_user: bool, metadata: Optional[Dict[str, Any]] = None):
        """Add a message to a conversation"""
        if conversation_id not in self.conversations:
            raise ValueError(f"Conversation {conversation_id} not found")
        
        conversation = self.conversations[conversation_id]
        
        # Create message object
        message_obj = {
            "id": str(uuid.uuid4()),
            "text": message,
            "is_user": is_user,
            "timestamp": datetime.now(),
            "metadata": metadata or {}
        }
        
        # Add message to conversation
        conversation["messages"].append(message_obj)
        conversation["updated_at"] = datetime.now()
        
        # Limit messages per conversation
        if len(conversation["messages"]) > self.max_messages_per_conversation:
            conversation["messages"] = conversation["messages"][-self.max_messages_per_conversation:]
        
        # Update statistics
        self.stats["total_messages"] += 1
        
        logger.debug(f"Added message to conversation {conversation_id}")
    
    def get_conversation_history(self, conversation_id: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get conversation history"""
        if conversation_id not in self.conversations:
            return []
        
        conversation = self.conversations[conversation_id]
        messages = conversation["messages"]
        
        if limit:
            messages = messages[-limit:]
        
        # Convert to simple format for the agent
        return [
            {
                "id": msg["id"],
                "text": msg["text"],
                "is_user": msg["is_user"],
                "timestamp": msg["timestamp"].isoformat(),
                "metadata": msg["metadata"]
            }
            for msg in messages
        ]
    
    def get_conversation(self, conversation_id: str) -> Optional[Dict[str, Any]]:
        """Get full conversation details"""
        if conversation_id not in self.conversations:
            return None
        
        conversation = self.conversations[conversation_id].copy()
        conversation["messages"] = self.get_conversation_history(conversation_id)
        return conversation
    
    def clear_conversation(self, conversation_id: str):
        """Clear a conversation"""
        if conversation_id in self.conversations:
            # Update statistics
            self.stats["active_conversations"] -= 1
            
            del self.conversations[conversation_id]
            logger.info(f"Cleared conversation {conversation_id}")
    
    def get_user_conversations(self, user_id: int, limit: int = 10) -> List[Dict[str, Any]]:
        """Get conversations for a specific user"""
        user_conversations = []
        
        for conv_id, conversation in self.conversations.items():
            if conversation["user_id"] == user_id:
                conv_summary = {
                    "id": conv_id,
                    "created_at": conversation["created_at"],
                    "updated_at": conversation["updated_at"],
                    "message_count": len(conversation["messages"]),
                    "last_message": conversation["messages"][-1]["text"] if conversation["messages"] else None
                }
                user_conversations.append(conv_summary)
        
        # Sort by updated_at (most recent first)
        user_conversations.sort(key=lambda x: x["updated_at"], reverse=True)
        
        return user_conversations[:limit]
    
    def _cleanup_old_conversations(self):
        """Clean up old conversations to prevent memory issues"""
        if len(self.conversations) <= self.max_conversations:
            return
        
        # Sort conversations by updated_at (oldest first)
        sorted_conversations = sorted(
            self.conversations.items(),
            key=lambda x: x[1]["updated_at"]
        )
        
        # Remove oldest conversations
        conversations_to_remove = len(self.conversations) - self.max_conversations
        
        for i in range(conversations_to_remove):
            conv_id, conversation = sorted_conversations[i]
            del self.conversations[conv_id]
            self.stats["active_conversations"] -= 1
            logger.info(f"Cleaned up old conversation {conv_id}")
    
    def cleanup_inactive_conversations(self, max_age_hours: int = 24):
        """Clean up conversations that haven't been updated recently"""
        cutoff_time = datetime.now() - timedelta(hours=max_age_hours)
        conversations_to_remove = []
        
        for conv_id, conversation in self.conversations.items():
            if conversation["updated_at"] < cutoff_time:
                conversations_to_remove.append(conv_id)
        
        for conv_id in conversations_to_remove:
            del self.conversations[conv_id]
            self.stats["active_conversations"] -= 1
            logger.info(f"Cleaned up inactive conversation {conv_id}")
        
        logger.info(f"Cleaned up {len(conversations_to_remove)} inactive conversations")
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get conversation manager statistics"""
        return {
            "total_conversations": self.stats["total_conversations"],
            "total_messages": self.stats["total_messages"],
            "active_conversations": self.stats["active_conversations"],
            "max_conversations": self.max_conversations,
            "max_messages_per_conversation": self.max_messages_per_conversation
        }
    
    def search_conversations(self, query: str, user_id: Optional[int] = None, limit: int = 10) -> List[Dict[str, Any]]:
        """Search conversations by message content"""
        results = []
        query_lower = query.lower()
        
        for conv_id, conversation in self.conversations.items():
            # Skip if user_id is specified and doesn't match
            if user_id is not None and conversation["user_id"] != user_id:
                continue
            
            # Search in messages
            for message in conversation["messages"]:
                if query_lower in message["text"].lower():
                    result = {
                        "conversation_id": conv_id,
                        "message_id": message["id"],
                        "text": message["text"],
                        "is_user": message["is_user"],
                        "timestamp": message["timestamp"],
                        "user_id": conversation["user_id"]
                    }
                    results.append(result)
        
        # Sort by timestamp (most recent first)
        results.sort(key=lambda x: x["timestamp"], reverse=True)
        
        return results[:limit]
    
    def export_conversation(self, conversation_id: str) -> Optional[Dict[str, Any]]:
        """Export a conversation for backup/analysis"""
        if conversation_id not in self.conversations:
            return None
        
        conversation = self.conversations[conversation_id]
        
        return {
            "conversation_id": conversation_id,
            "user_id": conversation["user_id"],
            "created_at": conversation["created_at"].isoformat(),
            "updated_at": conversation["updated_at"].isoformat(),
            "messages": [
                {
                    "id": msg["id"],
                    "text": msg["text"],
                    "is_user": msg["is_user"],
                    "timestamp": msg["timestamp"].isoformat(),
                    "metadata": msg["metadata"]
                }
                for msg in conversation["messages"]
            ],
            "metadata": conversation["metadata"]
        }
    
    def import_conversation(self, conversation_data: Dict[str, Any]) -> str:
        """Import a conversation from backup"""
        conversation_id = conversation_data.get("conversation_id", str(uuid.uuid4()))
        
        # Convert timestamps back to datetime objects
        conversation_data["created_at"] = datetime.fromisoformat(conversation_data["created_at"])
        conversation_data["updated_at"] = datetime.fromisoformat(conversation_data["updated_at"])
        
        for message in conversation_data["messages"]:
            message["timestamp"] = datetime.fromisoformat(message["timestamp"])
        
        self.conversations[conversation_id] = conversation_data
        
        # Update statistics
        self.stats["total_conversations"] += 1
        self.stats["active_conversations"] += 1
        self.stats["total_messages"] += len(conversation_data["messages"])
        
        logger.info(f"Imported conversation {conversation_id}")
        return conversation_id 