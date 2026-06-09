@echo off
echo === 简历筛选系统启动 ===

if "%ANTHROPIC_API_KEY%"=="" (
  echo 请先设置环境变量 ANTHROPIC_API_KEY
  echo 示例：set ANTHROPIC_API_KEY=sk-ant-xxxxx
  pause
  exit /b 1
)

echo 安装后端依赖...
cd backend && npm install
echo 安装前端依赖...
cd ../frontend && npm install
cd ..

echo 启动后端服务（端口 3001）...
start cmd /k "cd backend && node server.js"

echo 启动前端服务（端口 5173）...
start cmd /k "cd frontend && npm run dev"

echo.
echo 浏览器访问 http://localhost:5173
pause
