const express = require('express');
const router = express.Router();
const UserFlower = require('./userflower');
const flowersCatalog = require('./flowers.json'); // 기존 도감 파일 참조
const { v4: uuidv4 } = require('uuid'); // 토큰 생성을 위한 라이브러리 (npm install uuid 필요)
const dbConnect = require('./dbconnect');

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://floris-ebon.vercel.app';

// 1. 꽃 공유하기 (링크 생성)
router.post('/create-link', async (req, res) => {
  // userFlowerId(DB 고유 ID) 또는 flowerId(도감 번호) 둘 중 하나는 있어야 함
  const { userFlowerId, flowerId, letterContent, senderName, letterStyle } = req.body;

  try {
    await dbConnect();
    let flowerInstance;

    if (userFlowerId) {
      // 1. DB에 이미 있는 꽃을 공유하는 경우 (로그인 후)
      flowerInstance = await UserFlower.findById(userFlowerId);
      if (!flowerInstance) {
        return res.status(404).json({ message: "꽃을 찾을 수 없습니다." });
      }
      // 제약 조건 체크
      if (!flowerInstance.canShare()) {
        return res.status(400).json({ message: "이미 공유했거나 선물 받은 꽃은 공유할 수 없습니다." });
      }
    } else if (flowerId) {
      // 2. 도감 번호만으로 공유하는 경우 (비로그인/테스트용) -> DB에 새로 생성
      flowerInstance = new UserFlower({
        userId: 'guest', // 임시 사용자 ID
        flowerId: flowerId,
        isGift: false,
        isShared: false
      });
      await flowerInstance.save();
    } else {
      return res.status(400).json({ message: "꽃 ID가 필요합니다." });
    }

    // 도감 정보 미리 확인 (데이터 무결성)
    const flowerInfo = flowersCatalog.find(f => f.id === flowerInstance.flowerId);
    if (!flowerInfo) {
      return res.status(500).json({ message: "꽃 도감 정보를 찾을 수 없습니다." });
    }

    // 공유 상태 업데이트
    const shareToken = uuidv4(); // 고유 링크 토큰 생성
    flowerInstance.isShared = true;
    flowerInstance.shareInfo = {
      token: shareToken,
      letterContent: letterContent,
      senderName: senderName,
      letterStyle: letterStyle || "bg-rose-50", // 기본값 설정
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24시간 후 만료
    };

    await flowerInstance.save();

    const shareUrl = `${FRONTEND_URL}/share/${shareToken}`;

    // 공유용 메시지 (내용 숨김)
    let simpleDescription = "🌸 편지와 함께 꽃이 도착했습니다. 24시간 내 확인 하지 않으면 꽃이 시들어요!";
    if (senderName && senderName !== "익명의 정원사") {
      simpleDescription = `🌸 ${senderName}님으로부터 편지와 함께 꽃이 도착했습니다.\n24시간 내 확인 하지 않으면 꽃이 시들어요!`;
    }

    const buttonTitle = "매일 피어나는 작은 정원, 플로리스에서 확인하세요.";

    // 복사 붙여넣기용 전체 텍스트 구성 (링크 포함)
    const fullMessage = `[Floris] 일상에 꽃을 심다\n\n${simpleDescription}\n\n${buttonTitle}\n${shareUrl}`;

    res.json({
      success: true,
      shareLink: shareUrl,
      // 1. 일반 텍스트 공유용 (링크가 포함된 전체 메시지)
      message: fullMessage,
      // 2. 카카오톡 공유하기용 데이터 (요청하신 포맷)
      kakaoOptions: {
        title: "[Floris] 일상에 꽃을 심다",
        description: simpleDescription,
        imageUrl: `${FRONTEND_URL}${flowerInfo.image}`,
        buttonTitle: buttonTitle,
        link: {
          mobileWebUrl: shareUrl,
          webUrl: shareUrl
        }
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. 공유 링크 접속 (편지 및 꽃 정보 확인)
router.get('/:token', async (req, res) => {
  try {
    await dbConnect();
    const flowerInstance = await UserFlower.findOne({ 'shareInfo.token': req.params.token });
    
    if (!flowerInstance) {
      return res.status(404).json({ success: false, message: "유효하지 않은 링크입니다." });
    }

    // 만료 여부 확인
    if (flowerInstance.shareInfo && flowerInstance.shareInfo.expiresAt && new Date() > flowerInstance.shareInfo.expiresAt) {
      return res.status(410).json({ success: false, message: "유효 기간(24시간)이 만료된 선물입니다." });
    }

    // 이미 수령된 선물인지 확인 (UI 표시용)
    if (flowerInstance.shareInfo && flowerInstance.shareInfo.claimed) {
      return res.status(410).json({ success: false, message: "이미 누군가 수령한 선물입니다." });
    }

    const flowerInfo = flowersCatalog.find(f => f.id === flowerInstance.flowerId);
    if (!flowerInfo) {
      return res.status(500).json({ success: false, message: "꽃 정보를 불러올 수 없습니다." });
    }

    res.json({
      success: true,
      data: {
        senderName: flowerInstance.shareInfo.senderName,
        letterContent: flowerInstance.shareInfo.letterContent,
        letterStyle: flowerInstance.shareInfo.letterStyle || "bg-rose-50",
        flowerId: flowerInstance.flowerId, // 프론트엔드에서 찾을 수 있도록 ID 추가
        flowerInfo: flowerInfo
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. 꽃 받기 (내 도감에 추가)
router.post('/claim', async (req, res) => {
  const { token, receiverUserId } = req.body;

  // 필수 데이터 유효성 검사
  if (!token || !receiverUserId) {
    return res.status(400).json({ message: "토큰과 받는 사람 ID가 필요합니다." });
  }

  try {
    await dbConnect();
    // 원본 꽃 정보 찾기
    const originalFlower = await UserFlower.findOne({ 'shareInfo.token': token });
    
    if (!originalFlower) {
      return res.status(404).json({ message: "잘못된 접근입니다." });
    }

    // 만료 여부 확인
    if (originalFlower.shareInfo && originalFlower.shareInfo.expiresAt && new Date() > originalFlower.shareInfo.expiresAt) {
      return res.status(410).json({ message: "유효 기간이 만료되어 받을 수 없습니다." });
    }

    // 이미 수령된 선물인지 확인 (보안)
    if (originalFlower.shareInfo && originalFlower.shareInfo.claimed) {
      return res.status(410).json({ message: "이미 수령 완료된 선물입니다." });
    }

    // 본인이 보낸 꽃을 본인이 받는 경우 방지 (선택 사항)
    if (originalFlower.userId === receiverUserId) {
      return res.status(400).json({ message: "자신이 보낸 꽃은 받을 수 없습니다." });
    }

    // 받는 사람에게 새로운 꽃 생성 (복제)
    const newFlower = new UserFlower({
      userId: receiverUserId,
      flowerId: originalFlower.flowerId,
      isGift: true,   // 중요: 선물 받음 처리 (재공유 불가)
      isShared: false, // 아직 공유 안 함
      shareInfo: {
        senderName: originalFlower.shareInfo.senderName,
        letterContent: originalFlower.shareInfo.letterContent,
        letterStyle: originalFlower.shareInfo.letterStyle || "bg-rose-50",
        receivedAt: new Date()
      }
    });

    await newFlower.save();

    // 원본 꽃을 '수령됨' 상태로 변경
    originalFlower.shareInfo.claimed = true;
    await originalFlower.save();

    res.json({ success: true, message: "꽃이 편지함에 추가되었습니다!" });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;