#!/bin/bash

echo "Setting up NeuraTask AI Assistant..."
echo "================================="

echo ""
echo "Step 1: Installing Python dependencies..."
cd ai_agent
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "Error: Failed to install Python dependencies"
    exit 1
fi

echo ""
echo "Step 2: Setting up environment variables..."
echo "Please ensure the following environment variables are set in your .env file:"
echo "- OPENAI_API_KEY=your_openai_api_key"
echo "- AI_AGENT_MODE=local"
echo "- AI_AGENT_ENDPOINT=http://localhost:5000"
echo "- DB_HOST, DB_NAME, DB_USER, DB_PASSWORD (for database access)"

echo ""
echo "Step 3: Testing AI agent setup..."
python main.py --test
if [ $? -ne 0 ]; then
    echo "Warning: AI agent test failed, but setup may still work"
fi

echo ""
echo "Step 4: Starting AI agent server..."
echo "The AI agent will start automatically when the main backend starts."
echo "You can also start it manually by running: python ai_agent/main.py"

echo ""
echo "Setup complete!"
echo "The AI assistant is now integrated into your NeuraTask backend."
echo "" 