@echo off
echo 🔧 Fixing all sales order calculations using Node.js...
echo.

cd soft-sme-backend

echo 📊 Running Node.js fix script...
node fix_calculations_node.js

echo.
echo ✅ Fix completed! All sales orders should now have correct calculations.
echo.
pause
