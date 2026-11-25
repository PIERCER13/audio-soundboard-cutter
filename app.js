// @author piercer
(() => {
  const $ = (id) => document.getElementById(id);
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 64;
  analyser.connect(ctx.destination);

  let tracks = []; // { name, buffer }
  let activeSources = [];

  function drawSpectrum() {
    requestAnimationFrame(drawSpectrum);
    const canvas = $("specCanvas");
    const c = canvas.getContext("2d");
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    c.clearRect(0, 0, canvas.width, canvas.height);
    const barW = canvas.width / data.length;
    for (let i = 0; i < data.length; i++) {
      const h = (data[i] / 255) * (canvas.height - 10);
      c.fillStyle = "#ef4444";
      c.fillRect(i * barW + 2, canvas.height - h, barW - 4, h);
    }
  }
  drawSpectrum();

  function playBuffer(buffer, start = 0, duration = undefined, gainVal = 1) {
    if (ctx.state === "suspended") ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = gainVal;
    src.connect(g);
    g.connect(analyser);
    src.start(0, start, duration);
    activeSources.push(src);
    src.onended = () => {
      activeSources = activeSources.filter((s) => s !== src);
    };
  }

  function drawWaveform(buffer) {
    const canvas = $("waveCanvas");
    const c = canvas.getContext("2d");
    c.clearRect(0, 0, canvas.width, canvas.height);
    if (!buffer) return;
    const ch = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / canvas.width));
    const mid = canvas.height / 2;
    c.strokeStyle = "#ef4444";
    c.beginPath();
    for (let x = 0; x < canvas.width; x++) {
      let min = 1, max = -1;
      for (let j = 0; j < step; j++) {
        const v = ch[x * step + j] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      c.moveTo(x, mid + min * mid * 0.9);
      c.lineTo(x, mid + max * mid * 0.9);
    }
    c.stroke();
  }

  function renderTracks() {
    if (!tracks.length) return;
    $("padGrid").innerHTML = "";
    $("trimSelect").innerHTML = tracks.map((t, i) => `<option value="${i}">${t.name} (${t.buffer.duration.toFixed(1)}s)</option>`).join("");

    tracks.forEach((t, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pad-btn";
      btn.innerHTML = `<span class="pad-key">${i < 9 ? `Tecla ${i + 1}` : "Pad"}</span><span class="pad-name">${t.name}</span>`;
      btn.addEventListener("click", () => playBuffer(t.buffer));
      $("padGrid").appendChild(btn);
    });

    const first = tracks[0].buffer;
    $("trimStart").value = "0";
    $("trimEnd").value = first.duration.toFixed(1);
    drawWaveform(first);
  }

  function encodeWav(buffer) {
    const numCh = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const len = buffer.length * numCh * 2;
    const ab = new ArrayBuffer(44 + len);
    const v = new DataView(ab);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + len, true); str(8, "WAVE"); str(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, numCh, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * numCh * 2, true);
    v.setUint16(32, numCh * 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, len, true);

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numCh; ch++) {
        const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
        v.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([ab], { type: "audio/wav" });
  }

  function buildTrimmedBuffer() {
    const idx = Number($("trimSelect").value);
    const tr = tracks[idx];
    if (!tr) return null;
    const src = tr.buffer;
    const start = Math.max(0, Number($("trimStart").value) || 0);
    const end = Math.min(src.duration, Math.max(start + 0.1, Number($("trimEnd").value) || src.duration));
    const gain = (Number($("trimGain").value) || 100) / 100;
    const fi = Math.max(0, Number($("fadeIn").value) || 0);
    const fo = Math.max(0, Number($("fadeOut").value) || 0);

    const startSample = Math.floor(start * src.sampleRate);
    const endSample = Math.floor(end * src.sampleRate);
    const outLen = Math.max(1, endSample - startSample);
    const out = ctx.createBuffer(src.numberOfChannels, outLen, src.sampleRate);

    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const inp = src.getChannelData(ch);
      const oup = out.getChannelData(ch);
      for (let i = 0; i < outLen; i++) {
        let env = gain;
        const t = i / src.sampleRate;
        const rem = (outLen - i) / src.sampleRate;
        if (fi > 0 && t < fi) env *= t / fi;
        if (fo > 0 && rem < fo) env *= rem / fo;
        oup[i] = Math.max(-1, Math.min(1, inp[startSample + i] * env));
      }
    }
    return out;
  }

  $("audioFiles").addEventListener("change", async (e) => {
    for (const f of e.target.files || []) {
      const ab = await f.arrayBuffer();
      const buffer = await ctx.decodeAudioData(ab);
      tracks.push({ name: f.name, buffer });
    }
    renderTracks();
    e.target.value = "";
  });

  $("trimSelect").addEventListener("change", () => {
    const tr = tracks[Number($("trimSelect").value)];
    if (!tr) return;
    $("trimStart").value = "0";
    $("trimEnd").value = tr.buffer.duration.toFixed(1);
    drawWaveform(tr.buffer);
  });

  $("btnPreviewTrim").addEventListener("click", () => {
    const out = buildTrimmedBuffer();
    if (out) playBuffer(out);
  });

  $("btnExportWav").addEventListener("click", () => {
    const out = buildTrimmedBuffer();
    if (!out) return alert("Carregue um áudio primeiro.");
    const blob = encodeWav(out);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "piercer_audio_cortado.wav";
    a.click();
  });

  $("btnStopAll").addEventListener("click", () => {
    activeSources.forEach((s) => { try { s.stop(); } catch {} });
    activeSources = [];
  });

  document.addEventListener("keydown", (e) => {
    if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "SELECT") return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9 && tracks[n - 1]) {
      playBuffer(tracks[n - 1].buffer);
    }
  });
})();

(() => {
  const AUTO_KEY = "piercer_autosave_piercer_audio-soundboard-cutter";
  const ctrls = () => [...document.querySelectorAll('input[id]:not([type=file]), select[id], textarea[id]')];
  function saveForm() {
    const data = {};
    for (const el of ctrls()) data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    localStorage.setItem(AUTO_KEY, JSON.stringify(data));
  }
  try {
    const saved = JSON.parse(localStorage.getItem(AUTO_KEY) || 'null');
    if (saved) {
      for (const el of ctrls()) {
        if (!(el.id in saved)) continue;
        if (el.type === 'checkbox') el.checked = !!saved[el.id];
        else el.value = saved[el.id];
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  } catch {}
  document.addEventListener('input', saveForm);
  document.addEventListener('change', saveForm);
})();
