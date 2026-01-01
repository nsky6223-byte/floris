require('dotenv').config();
const express = require('express');
const cors = require('cors');
const shareRoutes = require('./shareroutes');

const app = express();

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// 라우트 설정 (프론트엔드 요청 경로: /api/share/...)
app.use('/api/share', shareRoutes);

// 서버 상태 확인용 루트 경로
app.get('/', (req, res) => {
  res.send('Floris API Server is running!');
});

module.exports = app;

// 로컬 환경에서 직접 실행할 때(npm start) 포트 리스닝
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}