# Fix ALL Purchase Order Sequences - PowerShell Script
# This script runs the comprehensive SQL fix directly using psql

Write-Host "🔧 Fixing ALL Purchase Order Sequences..." -ForegroundColor Yellow

# Check if psql is available
try {
    $psqlVersion = psql --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ psql found: $psqlVersion" -ForegroundColor Green
    } else {
        throw "psql not found"
    }
} catch {
    Write-Host "❌ psql not found. Please install PostgreSQL client tools or run the SQL manually." -ForegroundColor Red
    Write-Host "You can copy the contents of 'fix_all_sequences.sql' and run it in your database." -ForegroundColor Yellow
    exit 1
}

# Try to get database connection info from environment or prompt user
$databaseUrl = $env:DATABASE_URL
if (-not $databaseUrl) {
    Write-Host "DATABASE_URL environment variable not found." -ForegroundColor Yellow
    Write-Host "Please provide your database connection details:" -ForegroundColor Cyan
    
    $host = Read-Host "Database host (default: localhost)"
    if (-not $host) { $host = "localhost" }
    
    $port = Read-Host "Database port (default: 5432)"
    if (-not $port) { $port = "5432" }
    
    $database = Read-Host "Database name"
    $username = Read-Host "Username"
    $password = Read-Host "Password" -AsSecureString
    $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
    
    $databaseUrl = "postgresql://${username}:${password}@${host}:${port}/${database}"
}

# Extract connection details from DATABASE_URL
if ($databaseUrl -match "postgresql://([^:]+):([^@]+)@([^:]+):([^/]+)/(.+)") {
    $username = $matches[1]
    $password = $matches[2]
    $host = $matches[3]
    $port = $matches[4]
    $database = $matches[5]
    
    Write-Host "Connecting to: $host:$port/$database as $username" -ForegroundColor Cyan
    
    # Set PGPASSWORD environment variable for this session
    $env:PGPASSWORD = $password
    
    # Run the comprehensive SQL fix
    Write-Host "Running comprehensive sequence fix..." -ForegroundColor Yellow
    $sqlContent = Get-Content "fix_all_sequences.sql" -Raw
    
    try {
        $result = psql -h $host -p $port -U $username -d $database -c $sqlContent 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ ALL sequences fixed successfully!" -ForegroundColor Green
            Write-Host "Output:" -ForegroundColor Cyan
            Write-Host $result
        } else {
            Write-Host "❌ Error running sequence fix:" -ForegroundColor Red
            Write-Host $result
        }
    } catch {
        Write-Host "❌ Error executing psql command: $_" -ForegroundColor Red
    } finally {
        # Clear password from environment
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "❌ Invalid DATABASE_URL format. Expected: postgresql://username:password@host:port/database" -ForegroundColor Red
}

Write-Host "`nPress any key to continue..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
