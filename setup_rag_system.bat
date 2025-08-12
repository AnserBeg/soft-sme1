@echo off
echo SOFT SME RAG System Setup
echo =========================

echo.
echo Step 1: Installing dependencies...
pip install -r requirements_rag.txt

echo.
echo Step 2: Setting up vector database...
python rag_documentation_setup.py --test

echo.
echo Step 3: Testing the system...
python ai_assistant_rag_integration.py --demo

echo.
echo Setup complete! You can now:
echo - Run: python ai_assistant_rag_integration.py --interactive
echo - Or integrate the DocumentationVectorDB class into your AI assistant
echo.
pause 