const remoteVideo = document.getElementById("remote_video");
const dataTextInput = document.getElementById("data_text");
remoteVideo.controls = true;
let peerConnection = null;
let dataChannel = null;
let candidates = [];
let hasReceivedSdp = false;
// iceServer を定義
const iceServers = [
  {
    urls: "stun:stun.l.google.com:19302",
  },
];
// peer connection の 設定
const peerConnectionConfig = {
  iceServers: iceServers,
};

const isSSL = location.protocol === "https:";
const wsProtocol = isSSL ? "wss://" : "ws://";
const wsUrl = wsProtocol + location.host + "/ws";
const ws = new WebSocket(wsUrl);
ws.onopen = onWsOpen.bind();
ws.onerror = onWsError.bind();
ws.onmessage = onWsMessage.bind();

function onWsError(error) {
  console.error("ws onerror() ERROR:", error);
}

function onWsOpen(event) {
  console.log("ws open()");
}
function onWsMessage(event) {
  console.log("ws onmessage() data:", event.data);
  const message = JSON.parse(event.data);
  if (message.type === "offer") {
    console.log("Received offer ...");
    const offer = new RTCSessionDescription(message);
    console.log("offer: ", offer);
    setOffer(offer);
  } else if (message.type === "answer") {
    console.log("Received answer ...");
    const answer = new RTCSessionDescription(message);
    console.log("answer: ", answer);
    setAnswer(answer);
  } else if (message.type === "candidate") {
    console.log("Received ICE candidate ...");
    const candidate = new RTCIceCandidate(message.ice);
    console.log("candidate: ", candidate);
    if (hasReceivedSdp) {
      addIceCandidate(candidate);
    } else {
      candidates.push(candidate);
    }
  } else if (message.type === "close") {
    console.log("peer connection is closed ...");
  }
}

function connect() {
  console.group();
  if (!peerConnection) {
    console.log("make Offer");
    makeOffer();
  } else {
    console.warn("peer connection already exists.");
  }
  console.groupEnd();
}

function disconnect() {
  console.group();
  if (peerConnection) {
    if (peerConnection.iceConnectionState !== "closed") {
      peerConnection.close();
      peerConnection = null;
      if (ws && ws.readyState === 1) {
        const message = JSON.stringify({ type: "close" });
        ws.send(message);
      }
      console.log("sending close message");
      cleanupVideoElement(remoteVideo);
      return;
    }
  }
  console.log("peerConnection is closed.");
  console.groupEnd();
}

function drainCandidate() {
  hasReceivedSdp = true;
  candidates.forEach((candidate) => {
    addIceCandidate(candidate);
  });
  candidates = [];
}

function addIceCandidate(candidate) {
  if (peerConnection) {
    peerConnection.addIceCandidate(candidate);
  } else {
    console.error("PeerConnection does not exist!");
  }
}

function sendIceCandidate(candidate) {
  console.log("---sending ICE candidate ---");
  const message = JSON.stringify({ type: "candidate", ice: candidate });
  console.log("sending candidate=" + message);
  ws.send(message);
}

function playVideo(element, stream) {
  element.srcObject = stream;
}

function prepareNewConnection() {
  const peer = new RTCPeerConnection(peerConnectionConfig);
  dataChannel = peer.createDataChannel("serial");

  dataChannel.onmessage = function (event) {
    console.log("Got Data Channel Message:", event.data);
    var timeElapsed = document.getElementById("time_elapsed");
    var uvStatus = document.getElementById("uv_status");
    jsonData = JSON.parse(new TextDecoder().decode(event.data));
    var currentStatus = "";
    if (jsonData.status == "detect") {
      currentStatus = "消灯: 人を検出しました";
      uvStatus.style.backgroundColor = "yellow";
      uvStatus.style.color = "black";
    } else if (jsonData.status == "OFF") {
      currentStatus = "消灯: ボタンが押されました";
      uvStatus.style.backgroundColor = "blue";
      uvStatus.style.color = "white";
    } else {
      currentStatus = "紫外線照射中";
      uvStatus.style.backgroundColor = "red";
      uvStatus.style.color = "white";
    }
    timeElapsed.innerHTML =
      "累計照射時間: " + jsonData.hours + "時間" + jsonData.minutes + "分";
    uvStatus.innerHTML = currentStatus;
  };

  if ("ontrack" in peer) {
    if (isSafari()) {
      let tracks = [];
      peer.ontrack = (event) => {
        console.log("-- peer.ontrack()");
        tracks.push(event.track);
        // safari で動作させるために、ontrack が発火するたびに MediaStream を作成する
        let mediaStream = new MediaStream(tracks);
        playVideo(remoteVideo, mediaStream);
      };
    } else {
      let mediaStream = new MediaStream();
      playVideo(remoteVideo, mediaStream);
      peer.ontrack = (event) => {
        console.log("-- peer.ontrack()");
        mediaStream.addTrack(event.track);
      };
    }
  } else {
    peer.onaddstream = (event) => {
      console.log("-- peer.onaddstream()");
      playVideo(remoteVideo, event.stream);
    };
  }
  peer.onicecandidate = (event) => {
    console.log("-- peer.onicecandidate()");
    if (event.candidate) {
      console.log(event.candidate);
      sendIceCandidate(event.candidate);
    } else {
      console.log("empty ice event");
    }
  };

  peer.oniceconnectionstatechange = () => {
    console.log("-- peer.oniceconnectionstatechange()");
    console.log(
      "ICE connection Status has changed to " + peer.iceConnectionState
    );
    switch (peer.iceConnectionState) {
      case "closed":
      case "failed":
      case "disconnected":
        break;
    }
  };
  peer.addTransceiver("video", { direction: "recvonly" });
  peer.addTransceiver("audio", { direction: "recvonly" });

  return peer;
}

function browser() {
  const ua = window.navigator.userAgent.toLocaleLowerCase();
  if (ua.indexOf("edge") !== -1) {
    return "edge";
  } else if (ua.indexOf("chrome") !== -1 && ua.indexOf("edge") === -1) {
    return "chrome";
  } else if (ua.indexOf("safari") !== -1 && ua.indexOf("chrome") === -1) {
    return "safari";
  } else if (ua.indexOf("opera") !== -1) {
    return "opera";
  } else if (ua.indexOf("firefox") !== -1) {
    return "firefox";
  }
  return;
}

function isSafari() {
  return browser() === "safari";
}

function sendSdp(sessionDescription) {
  console.log("---sending sdp ---");
  const message = JSON.stringify(sessionDescription);
  console.log("sending SDP=" + message);
  ws.send(message);
}

async function makeOffer() {
  peerConnection = prepareNewConnection();
  try {
    const sessionDescription = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    console.log(
      "createOffer() success in promise, SDP=",
      sessionDescription.sdp
    );
    sessionDescription.sdp = removeCodec(sessionDescription.sdp, "VP8");
    sessionDescription.sdp = removeCodec(sessionDescription.sdp, "VP9");
    await peerConnection.setLocalDescription(sessionDescription);
    console.log("setLocalDescription() success in promise");
    sendSdp(peerConnection.localDescription);
  } catch (error) {
    console.error("makeOffer() ERROR:", error);
  }
}

async function makeAnswer() {
  console.log("sending Answer. Creating remote session description...");
  if (!peerConnection) {
    console.error("peerConnection DOES NOT exist!");
    return;
  }
  try {
    const sessionDescription = await peerConnection.createAnswer();
    console.log("createAnswer() success in promise");
    await peerConnection.setLocalDescription(sessionDescription);
    console.log("setLocalDescription() success in promise");
    sendSdp(peerConnection.localDescription);
    drainCandidate();
  } catch (error) {
    console.error("makeAnswer() ERROR:", error);
  }
}

// offer sdp を生成する
function setOffer(sessionDescription) {
  if (peerConnection) {
    console.error("peerConnection already exists!");
  }
  const peerConnection = prepareNewConnection();
  peerConnection.onnegotiationneeded = async function () {
    try {
      await peerConnection.setRemoteDescription(sessionDescription);
      console.log("setRemoteDescription(offer) success in promise");
      makeAnswer();
    } catch (error) {
      console.error("setRemoteDescription(offer) ERROR: ", error);
    }
  };
}

async function setAnswer(sessionDescription) {
  if (!peerConnection) {
    console.error("peerConnection DOES NOT exist!");
    return;
  }
  try {
    await peerConnection.setRemoteDescription(sessionDescription);
    console.log("setRemoteDescription(answer) success in promise");
    drainCandidate();
  } catch (error) {
    console.error("setRemoteDescription(answer) ERROR: ", error);
  }
}

function cleanupVideoElement(element) {
  element.pause();
  element.srcObject = null;
}

// Stack Overflow より引用: https://stackoverflow.com/a/52760103
// https://stackoverflow.com/questions/52738290/how-to-remove-video-codecs-in-webrtc-sdp
function removeCodec(orgsdp, codec) {
  const internalFunc = (sdp) => {
    const codecre = new RegExp("(a=rtpmap:(\\d*) " + codec + "/90000\\r\\n)");
    const rtpmaps = sdp.match(codecre);
    if (rtpmaps == null || rtpmaps.length <= 2) {
      return sdp;
    }
    const rtpmap = rtpmaps[2];
    let modsdp = sdp.replace(codecre, "");

    const rtcpre = new RegExp("(a=rtcp-fb:" + rtpmap + ".*\r\n)", "g");
    modsdp = modsdp.replace(rtcpre, "");

    const fmtpre = new RegExp("(a=fmtp:" + rtpmap + ".*\r\n)", "g");
    modsdp = modsdp.replace(fmtpre, "");

    const aptpre = new RegExp("(a=fmtp:(\\d*) apt=" + rtpmap + "\\r\\n)");
    const aptmaps = modsdp.match(aptpre);
    let fmtpmap = "";
    if (aptmaps != null && aptmaps.length >= 3) {
      fmtpmap = aptmaps[2];
      modsdp = modsdp.replace(aptpre, "");

      const rtppre = new RegExp("(a=rtpmap:" + fmtpmap + ".*\r\n)", "g");
      modsdp = modsdp.replace(rtppre, "");
    }

    let videore = /(m=video.*\r\n)/;
    const videolines = modsdp.match(videore);
    if (videolines != null) {
      // If many m=video are found in SDP, this program doesn't work.
      let videoline = videolines[0].substring(0, videolines[0].length - 2);
      const videoelems = videoline.split(" ");
      let modvideoline = videoelems[0];
      videoelems.forEach((videoelem, index) => {
        if (index === 0) return;

        if (videoelem == rtpmap || videoelem == fmtpmap) {
          return;
        }
        modvideoline += " " + videoelem;
      });
      modvideoline += "\r\n";
      modsdp = modsdp.replace(videore, modvideoline);
    }
    return internalFunc(modsdp);
  };
  return internalFunc(orgsdp);
}

function play() {
  remoteVideo.play();
}

function sendDataChannel() {
  let textData = dataTextInput.value;
  if (textData.length == 0) {
    return;
  }
  if (dataChannel == null || dataChannel.readyState != "open") {
    return;
  }
  dataChannel.send(new TextEncoder().encode(textData));
  dataTextInput.value = "";
}

function sendGamepadData(GamepadData) {
  let textData = GamepadData;
  if (textData.length == 0) {
    return;
  }
  if (dataChannel == null || dataChannel.readyState != "open") {
    return;
  }
  dataChannel.send(new TextEncoder().encode(textData));
}

/*
 * Gamepad API demonstration ECMAScript by DigiSapo
 *
 * Copyright (c) 2018 DigiSapo(http://www.plaza14.biz/sitio_digisapo/)
 * This software is released under the MIT License:
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// ========================================================
// JoystickPanel implementation
// ========================================================

var JoystickPanel = {
  numConnected: 0,
  selectedGamepadUID: null,
  configAxes: [],
  axesCheck: null,
  updateTimerMilliSec: 1000 / 30,
  updateTimerId: null,
  gamepadsList: null,
  axesMapperSelect: 0,
  axesMapper: [
    null,
    {
      query: /CH COMBATSTICK/i,
      axesMapping: [
        {
          style: "auto",
        },
        {
          style: "throttle",
          dir: 1,
        },
        {
          style: "hat",
          dir: 1,
        },
      ],
    },
    {
      query: /Flight|Throttle(?:.*)Quadrant/i,
      axesMapping: [
        {
          style: "throttle",
          dir: 1,
        },
        {
          style: "throttle",
          dir: 1,
        },
        {
          style: "throttle",
          dir: 1,
        },
      ],
    },
    {
      query: /CH PRO PEDALS/i,
      axesMapping: [
        {
          style: "throttle",
          dir: 1,
        },
        {
          style: "throttle",
          dir: 1,
        },
        {
          style: "yaw",
          dir: 1,
        },
      ],
    },
    {
      query: /Sidewinder(?:.*)Joystick/i,
      axesMapping: [
        {
          style: "auto",
        },
        {
          style: "yaw",
          dir: 1,
        },
        {
          style: "throttle",
          dir: 1,
        },
        {
          style: "hat",
          dir: -1,
        },
      ],
    },
  ],
};

JoystickPanel.selectGamepad = function (gamepad_uuid) {
  this.selectedGamepadUID = gamepad_uuid;
  this.axesMapperSelect = 0;
  var num = this.axesMapper.length;
  var i;
  for (i = 1; i < num; i++) {
    if (this.axesMapper[i].query.test(gamepad_uuid)) {
      this.axesMapperSelect = i;
      break;
    }
  }
  this.axesCheck = null;
  return this.selectedGamepadUID ? true : false;
};

JoystickPanel.getSelectedGamepadData = function () {
  var result = null;
  var num = this.gamepadsList.length;
  var i;
  for (i = 0; i < num; i++) {
    var tmp = this.gamepadsList[i];
    if (
      tmp &&
      tmp.index != undefined &&
      tmp.index + tmp.id == this.selectedGamepadUID
    ) {
      result = tmp;
      break;
    }
  }
  return result;
};

JoystickPanel.checkNewAxesMove = function (gamepad) {
  var result = 0;
  if (gamepad.axes && gamepad.axes.length > 0) {
    var i;
    var num_axes = gamepad.axes.length;
    if (this.axesCheck && this.axesCheck.length == num_axes) {
      for (i = 0; i < num_axes; i++) {
        var v = this.axesCheck[i].value;
        if (v != gamepad.axes[i]) {
          if (!this.axesCheck[i].show) {
            result++;
            this.axesCheck[i].show = true;
          }
        }
        if (this.axesCheck[i].show && (v < -1.01 || v > 1.01)) {
          if (!this.axesCheck[i].customStyle) {
            result++;
            this.axesCheck[i].customStyle = true;
          }
        }
      }
    } else {
      this.axesCheck = new Array(num_axes);
      for (i = 0; i < num_axes; i++) {
        this.axesCheck[i] = {
          show: false,
          value: gamepad.axes[i],
          customStyle: false,
        };
      }
    }
  }
  return result;
};

JoystickPanel.updateGamepadData = function () {
  if (!navigator.getGamepads) return;

  this.gamepadsList = navigator.getGamepads();
  var gamepad = this.getSelectedGamepadData();

  if (!gamepad || !gamepad.connected) {
    // disconnected
    //
    return;
  }
  // raw data text mode
  //
  var result = '{"ID":"' + gamepad.id + '",';
  result += '"TIMESTAMP":' + Math.round(gamepad.timestamp * 100) / 100 + ",";
  result += '"INDEX":' + gamepad.index + ",";
  result += '"MAPPING":"' + gamepad.mapping + '",';

  var gamepad_data =
    '{"TIME":' + Math.round(gamepad.timestamp * 100) / 100 + ",";

  if (gamepad.axes && gamepad.axes.length > 0) {
    var num_axes = gamepad.axes.length;
    var i;
    result += '"AXES":{';
    gamepad_data += '"AXES":{';
    for (i = 0; i < num_axes; i++) {
      if (i < num_axes - 1) {
        result +=
          '"#' +
          ("00" + i).slice(-2) +
          '":' +
          Math.round(gamepad.axes[i] * 100) / 100 +
          ",";
        gamepad_data +=
          '"#' +
          ("00" + i).slice(-2) +
          '":' +
          Math.round(gamepad.axes[i] * 100) / 100 +
          ",";
      } else {
        result +=
          '"#' +
          ("00" + i).slice(-2) +
          '":' +
          Math.round(gamepad.axes[i] * 100) / 100;
        gamepad_data +=
          '"#' +
          ("00" + i).slice(-2) +
          '":' +
          Math.round(gamepad.axes[i] * 100) / 100;
      }
    }
    result += "},";
    gamepad_data += "},";
  } else {
    result += '"AXES":{},';
    gamepad_data += '"AXES":{},';
  }
  if (gamepad.buttons && gamepad.buttons.length > 0) {
    var num_buttons = gamepad.buttons.length;
    var i;
    var button_value;
    result += '"BUTTON":{';
    gamepad_data += '"BUTTON":{';
    for (i = 0; i < num_buttons; i++) {
      result += '"#' + ("00" + i).slice(-2) + '":';
      gamepad_data += '"#' + ("00" + i).slice(-2) + '":';
      button_value = Math.round(gamepad.buttons[i].value);
      if (i < num_buttons - 1) {
        result += Math.round(gamepad.buttons[i].value * 100) / 100 + ",";
        gamepad_data += Math.round(gamepad.buttons[i].value * 100) / 100 + ",";
      } else {
        result += Math.round(gamepad.buttons[i].value * 100) / 100;
        gamepad_data += Math.round(gamepad.buttons[i].value * 100) / 100;
      }
    }
    result += "},";
    result += '"TOTAL AXES":' + num_axes + ",";
    result += '"TOTAL BUTTONS":' + num_buttons;
    result += "}";
    gamepad_data += "}}\n";
    sendGamepadData(gamepad_data);
  } else {
    result = result + "NO BUTTONS.<br/><br/>";
  }
};

JoystickPanel.init = function () {
  if (navigator.getGamepads) {
    console.log("Gamepad API 対応");
    this.gamepadsList = navigator.getGamepads();
  }
  this.axesCheck = null;

};

JoystickPanel.updateTimerCallback = function () {
  JoystickPanel.updateGamepadData();
  JoystickPanel.updateTimerId = setTimeout(
    JoystickPanel.updateTimerCallback,
    JoystickPanel.updateTimerMilliSec
  );
};
JoystickPanel.updateTimerStart = function () {
  JoystickPanel.updateTimerStop();
  JoystickPanel.updateTimerCallback();
};

JoystickPanel.updateTimerStop = function () {
  clearTimeout(JoystickPanel.updateTimerId);
  JoystickPanel.updateTimerId = null;
};

// Global function(s)
//
//

function axis_value_2_str(v, dig, dig_frac) {
  return (Array(dig + 1).join(" ") + v.toFixed(dig_frac)).slice(-dig);
}

/*
 * Gamepad をセレクターから選択した場合のイベント
 */
var gamepad_selector_change = function () {
  JoystickPanel.updateTimerStop();
  var gamepad_selector = document.getElementById("gamepad_selector");
  var gamepad_uuid =
    gamepad_selector.options[gamepad_selector.selectedIndex].value;
  if (JoystickPanel.selectGamepad(gamepad_uuid)) {
    JoystickPanel.updateTimerStart();
  }
};
/*
 * Gamepad オブジェクトと一致するセレクターのアイテムを検索
 */
var gamepad_selector_find = function (gamepad) {
  if (!JoystickPanel.gamepadsList || !gamepad) return;

  var result = null;
  var gamepad_uuid = gamepad.index + gamepad.id;
  return result ? gamepad_uuid : null;
};

/*
 * ローディング時の初期化処理
 */

(function () {
  JoystickPanel.init();

  /* Gamepad 接続時のイベント */
  window.addEventListener("gamepadconnected", function (e) {
    var gamepad = e.gamepad;
    JoystickPanel.numConnected++;
    var gamepad_uuid = gamepad.index + gamepad.id;
    var gamepad_status = document.getElementById("gamepad_status");
    gamepad_status.style.color = "#0e552b";
    gamepad_status.innerHTML =
          "<i class='fas fa-gamepad'></i> ゲームパッドが接続されています";
    if (gamepad_uuid) {
      /* ゲームパッドが再接続された場合 */
      console.log(
        "gamepad connected... index=" +
          gamepad.index +
          ", id='" +
          gamepad.id +
          "'"
      );
      JoystickPanel.updateTimerStop();
      JoystickPanel.selectGamepad(gamepad_uuid);
      if (JoystickPanel.selectGamepad(gamepad_uuid)) {
        JoystickPanel.updateTimerStart();
      }
    } else {
      /* 新しいゲームパッドが接続された場合 */
      console.log(
        "new gamepad connected... index=" +
          gamepad.index +
          ", id='" +
          gamepad.id +
          "'"
      );
    }
  });
  /* Gamepad 切断時のイベント */
  window.addEventListener("gamepaddisconnected", function (e) {
    var gamepad = e.gamepad;
    JoystickPanel.numConnected--;
    console.log(
      "new gamepad disconnected... index=" +
        gamepad.index +
        ", id='" +
        gamepad.id +
        "'"
    );
    var gamepad_status = document.getElementById("gamepad_status");
    gamepad_status.style.color = "#7c0000";
    gamepad_status.innerHTML =
      "<i class='fas fa-gamepad'></i> ゲームパッドが切断されています";
  });
})();

/*
 * PS4コントローラ
 */
var buttonNames = [
  "×",
  "○",
  "□",
  "△",
  "L1",
  "R1",
  "L2",
  "R2",
  "SH",
  "OP",
  "L3",
  "R3",
  "↑",
  "↓",
  "←",
  "→",
  "PS",
  "TP",
];

4;
5;
6;
7;
8;
9;
// 引数にはミリ秒を指定します。（例：5秒の場合は5000）
function sleep(a) {
  var dt1 = new Date().getTime();
  var dt2 = new Date().getTime();
  while (dt2 < dt1 + a) {
    dt2 = new Date().getTime();
  }
  return;
}
