#!/bin/bash

# Docker Configuration Check Script
# Validates Dockerfile, docker-compose.yaml, and build context

set -e

echo "================================================"
echo "Docker Configuration Check"
echo "================================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_pass() {
    echo -e "${GREEN}✓${NC} $1"
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

ISSUES=0
WARNINGS=0

# ================================================
# 1. Check required files
# ================================================
echo "[1] Checking required files..."

if [ -f "server/Dockerfile" ]; then
    check_pass "Dockerfile exists"
else
    check_fail "Dockerfile not found"
    ISSUES=$((ISSUES + 1))
fi

if [ -f "docker-compose.yaml" ]; then
    check_pass "docker-compose.yaml exists"
else
    check_fail "docker-compose.yaml not found"
    ISSUES=$((ISSUES + 1))
fi

if [ -f "server/package.json" ]; then
    check_pass "package.json exists"
else
    check_fail "package.json not found"
    ISSUES=$((ISSUES + 1))
fi

if [ -f "server/index.js" ]; then
    check_pass "index.js exists"
else
    check_fail "index.js not found"
    ISSUES=$((ISSUES + 1))
fi

if [ -f "server/.dockerignore" ]; then
    check_pass ".dockerignore exists"
else
    check_warn ".dockerignore not found (will copy all files)"
    WARNINGS=$((WARNINGS + 1))
fi

if [ -f ".env" ]; then
    check_pass ".env file exists"
else
    check_warn ".env file not found (using defaults)"
    WARNINGS=$((WARNINGS + 1))
fi

if [ -f "server/package-lock.json" ]; then
    check_pass "package-lock.json exists (faster builds)"
else
    check_warn "package-lock.json not found (slower builds, version drift possible)"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""

# ================================================
# 2. Validate Dockerfile
# ================================================
echo "[2] Validating Dockerfile..."

# Check Node version
NODE_VERSION=$(grep "^FROM node:" server/Dockerfile | sed 's/FROM node://' | cut -d'-' -f1)
if [ -n "$NODE_VERSION" ]; then
    check_pass "Node version: $NODE_VERSION"
else
    check_fail "Node version not found in Dockerfile"
    ISSUES=$((ISSUES + 1))
fi

# Check WORKDIR
if grep -q "WORKDIR /app" server/Dockerfile; then
    check_pass "WORKDIR is set to /app"
else
    check_warn "WORKDIR not set or different"
    WARNINGS=$((WARNINGS + 1))
fi

# Check if files are copied
if grep -q "COPY package.json" server/Dockerfile; then
    check_pass "package.json is copied"
else
    check_fail "package.json is not copied"
    ISSUES=$((ISSUES + 1))
fi

if grep -q "COPY index.js" server/Dockerfile; then
    check_pass "index.js is copied"
else
    check_fail "index.js is not copied"
    ISSUES=$((ISSUES + 1))
fi

# Check npm install
if grep -q "npm install" server/Dockerfile; then
    check_pass "npm install is run"
else
    check_fail "npm install is not run"
    ISSUES=$((ISSUES + 1))
fi

# Check non-root user
if grep -q "USER app" server/Dockerfile || grep -q "USER node" server/Dockerfile; then
    check_pass "Running as non-root user (security best practice)"
else
    check_warn "Running as root user (security risk)"
    WARNINGS=$((WARNINGS + 1))
fi

# Check CMD
if grep -q 'CMD.*node.*index.js' server/Dockerfile; then
    check_pass "CMD starts the application"
else
    check_fail "CMD not found or incorrect"
    ISSUES=$((ISSUES + 1))
fi

echo ""

# ================================================
# 3. Validate docker-compose.yaml
# ================================================
echo "[3] Validating docker-compose.yaml..."

# Check build context
if grep -q "context: ./server" docker-compose.yaml; then
    check_pass "Build context is set to ./server"
else
    check_fail "Build context incorrect or missing"
    ISSUES=$((ISSUES + 1))
fi

# Check volumes
if grep -q "./data:/app/data" docker-compose.yaml; then
    check_pass "Data volume mounted (./data:/app/data)"
else
    check_fail "Data volume not mounted"
    ISSUES=$((ISSUES + 1))
fi

# Check required environment variables
REQUIRED_VARS=("GOOGLE_API_KEY" "APP_TOKEN" "PORT")
for var in "${REQUIRED_VARS[@]}"; do
    if grep -q "$var" docker-compose.yaml; then
        check_pass "Environment variable $var is defined"
    else
        check_fail "Environment variable $var is missing"
        ISSUES=$((ISSUES + 1))
    fi
done

# Check healthcheck
if grep -q "healthcheck:" docker-compose.yaml; then
    check_pass "Healthcheck is configured"
else
    check_warn "Healthcheck not configured"
    WARNINGS=$((WARNINGS + 1))
fi

# Check restart policy
if grep -q "restart: unless-stopped" docker-compose.yaml || grep -q "restart: always" docker-compose.yaml; then
    check_pass "Restart policy is set"
else
    check_warn "Restart policy not set"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""

# ================================================
# 4. Check .dockerignore patterns
# ================================================
echo "[4] Checking .dockerignore patterns..."

if [ -f "server/.dockerignore" ]; then
    # Check for common patterns
    PATTERNS=("node_modules" ".env" ".git" "*.sqlite")
    for pattern in "${PATTERNS[@]}"; do
        if grep -q "$pattern" server/.dockerignore; then
            check_pass "Ignoring $pattern"
        else
            check_warn "$pattern not in .dockerignore"
            WARNINGS=$((WARNINGS + 1))
        fi
    done
else
    check_warn ".dockerignore not found - all files will be copied"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""

# ================================================
# 5. Check for unnecessary files in build context
# ================================================
echo "[5] Checking build context size..."

if [ -d "server/node_modules" ]; then
    check_warn "node_modules exists in build context (should be in .dockerignore)"
    WARNINGS=$((WARNINGS + 1))
else
    check_pass "No node_modules in build context"
fi

if [ -f "server/.env" ]; then
    check_warn ".env file in build context (should be in .dockerignore)"
    WARNINGS=$((WARNINGS + 1))
else
    check_pass "No .env file in build context"
fi

# Count files that will be copied
FILE_COUNT=$(find server -type f 2>/dev/null | wc -l | tr -d ' ')
echo "   Files in build context: $FILE_COUNT"

if [ "$FILE_COUNT" -gt 50 ]; then
    check_warn "Large number of files in build context ($FILE_COUNT). Consider using .dockerignore"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""

# ================================================
# 6. Validate data directory
# ================================================
echo "[6] Checking data directory..."

if [ -d "data" ]; then
    check_pass "data directory exists"

    # Check permissions
    PERMS=$(stat -f "%Lp" data 2>/dev/null || stat -c "%a" data 2>/dev/null)
    if [ -n "$PERMS" ]; then
        echo "   Permissions: $PERMS"
        if [ "$PERMS" = "700" ] || [ "$PERMS" = "755" ]; then
            check_pass "data directory has secure permissions"
        else
            check_warn "data directory permissions: $PERMS (consider 700 or 755)"
            WARNINGS=$((WARNINGS + 1))
        fi
    fi
else
    check_warn "data directory does not exist (will be created on first run)"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""

# ================================================
# 7. Summary
# ================================================
echo "================================================"
echo "Summary"
echo "================================================"
echo "Issues: $ISSUES"
echo "Warnings: $WARNINGS"
echo ""

if [ $ISSUES -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "You can now run:"
    echo "  docker compose up -d"
    exit 0
elif [ $ISSUES -eq 0 ]; then
    echo -e "${YELLOW}⚠ No critical issues, but ${WARNINGS} warning(s) found${NC}"
    echo ""
    echo "You can still run, but consider fixing warnings:"
    echo "  docker compose up -d"
    exit 0
else
    echo -e "${RED}✗ Found ${ISSUES} critical issue(s) and ${WARNINGS} warning(s)${NC}"
    echo ""
    echo "Please fix the issues before running:"
    echo "  docker compose up -d"
    exit 1
fi
