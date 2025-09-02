@echo off
echo 🔧 Fixing all sales order calculations...
echo.

cd soft-sme-backend

echo 📊 Running SQL fix script...
psql %DATABASE_URL% -f fix_calculations.sql

echo.
echo ✅ Fix completed! All sales orders should now have correct calculations.
echo.
pause
