$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
Set-Location "$PSScriptRoot"
Write-Host "Go version: $(go version)"
Write-Host ""
Write-Host "=== go mod tidy ==="
go mod tidy
if ($LASTEXITCODE -ne 0) { Write-Error "go mod tidy failed"; exit 1 }

Write-Host ""
Write-Host "=== go build ==="
go build -o push.exe ./cmd/push
if ($LASTEXITCODE -ne 0) { Write-Error "go build failed"; exit 1 }

Write-Host ""
Write-Host "=== go test ==="
go test -v ./pusher/...
if ($LASTEXITCODE -ne 0) { Write-Error "go test failed"; exit 1 }

Write-Host ""
Write-Host "=== self-test (--verify) ==="
.\push.exe --verify
if ($LASTEXITCODE -ne 0) { Write-Error "self-test failed"; exit 1 }

Write-Host ""
Write-Host "All steps completed successfully."
