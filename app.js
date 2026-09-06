const GAS_URL = "https://script.google.com/macros/s/AKfycbymzundW-n2WlYGyZWAOK19lFLA8-8ssrMu_HG1tk7IXk-OJnH0GYlM0Vcx2QbGjl2q/exec";

let appState = {
    password: localStorage.getItem('mahjong_pwd') || '',
    cachedMembers: [],
    dayRecords: [],
    allRecords: [], // 集計用全データ
    availableDates: [],
    lastUsedMembers: JSON.parse(localStorage.getItem('mahjong_last_players')) || [],
    editingId: null, 
    dailyChartInstance: null,
    summaryChartInstance: null,
    currentTab: 'daily'
};

window.onload = () => {
    document.getElementById("target-date").value = new Date().toISOString().split('T')[0];
    const savedMode = localStorage.getItem('mahjong_mode');
    if (savedMode) document.getElementById("game-mode").value = savedMode;

    if (appState.password) {
        fetchData(true);
    }
};

// タブ切り替え
function switchTab(tabName) {
    appState.currentTab = tabName;
    document.getElementById("tab-daily").classList.toggle("active", tabName === 'daily');
    document.getElementById("tab-summary").classList.toggle("active", tabName === 'summary');
    document.getElementById("view-daily").classList.toggle("hidden", tabName !== 'daily');
    document.getElementById("view-summary").classList.toggle("hidden", tabName !== 'summary');

    if (tabName === 'summary' && appState.allRecords.length === 0) {
        fetchSummaryData();
    }
}

async function login() {
    appState.password = document.getElementById("password-input").value;
    await fetchData();
}

async function fetchData(isAutoLogin = false) {
    const targetDate = document.getElementById("target-date").value;
    try {
        const res = await fetch(GAS_URL, {
            method: "POST",
            body: JSON.stringify({ action: "fetch_data", password: appState.password, date: targetDate })
        });
        const json = await res.json();

        if (json.status === "success") {
            localStorage.setItem('mahjong_pwd', appState.password);
            document.getElementById("auth-screen").classList.add("hidden");
            document.getElementById("main-screen").classList.remove("hidden");
            document.getElementById("auth-error").textContent = "";

            appState.cachedMembers = json.members;
            appState.dayRecords = json.records;
            appState.availableDates = json.availableDates || [];
            
            renderPastDatesSelect();
            renderHistoryAndChart();
            if (!appState.editingId) renderPlayerInputs();
        } else {
            if (isAutoLogin) {
                localStorage.removeItem('mahjong_pwd');
                appState.password = '';
            } else {
                document.getElementById("auth-error").textContent = json.message;
            }
        }
    } catch (e) {
        alert("通信に失敗しました。");
    }
}

// 集計用全データ取得
async function fetchSummaryData() {
    try {
        const res = await fetch(GAS_URL, {
            method: "POST",
            body: JSON.stringify({ action: "fetch_summary", password: appState.password })
        });
        const json = await res.json();
        if (json.status === "success") {
            appState.allRecords = json.allRecords;
            populateYearFilter();
            renderSummaryView();
        }
    } catch (e) {
        alert("集計データの取得に失敗しました。");
    }
}

// 年度フィルターのオプション設定
function populateYearFilter() {
    const select = document.getElementById("summary-period-select");
    const years = new Set(appState.allRecords.map(r => r.year));
    
    let html = `<option value="all">全期間通算</option>`;
    Array.from(years).sort().reverse().forEach(y => {
        html += `<option value="${y}">${y}年度</option>`;
    });
    select.innerHTML = html;
}

// 集計画面の描画（テーブル ＆ 通算グラフ）
function renderSummaryView() {
    const period = document.getElementById("summary-period-select").value;
    let filteredRecords = appState.allRecords;
    
    if (period !== 'all') {
        filteredRecords = appState.allRecords.filter(r => r.year === parseInt(period));
    }

    let stats = {}; 
    let cumulativeTimeline = {}; 

    filteredRecords.forEach(rec => {
        let playersInGame = [];
        for (let i = 0; i < rec.data.length; i += 2) {
            if (rec.data[i]) {
                playersInGame.push({ name: rec.data[i], score: parseFloat(rec.data[i+1]) || 0 });
            }
        }
        playersInGame.sort((a, b) => b.score - a.score);

        playersInGame.forEach((p, rankIndex) => {
            if (!stats[p.name]) {
                stats[p.name] = { games: 0, totalScore: 0, ranks: [0, 0, 0, 0], topCount: 0 };
                cumulativeTimeline[p.name] = [];
            }
            stats[p.name].games++;
            stats[p.name].totalScore += p.score;
            stats[p.name].ranks[rankIndex]++;
            if (rankIndex === 0) stats[p.name].topCount++;
        });

        Object.keys(stats).forEach(name => {
            let pInGame = playersInGame.find(p => p.name === name);
            let prev = cumulativeTimeline[name].length > 0 ? cumulativeTimeline[name][cumulativeTimeline[name].length - 1] : 0;
            cumulativeTimeline[name].push(prev + (pInGame ? pInGame.score : 0));
        });
    });

    let sortedStats = Object.entries(stats).sort((a, b) => b[1].totalScore - a[1].totalScore);

    let tbodyHtml = "";
    sortedStats.forEach(([name, s], idx) => {
        let winRate = ((s.topCount / s.games) * 100).toFixed(1) + "%";
        
        let rankSum = s.ranks.reduce((sum, count, rIdx) => sum + count * (rIdx + 1), 0);
        let avgRank = (rankSum / s.games).toFixed(2);
        
        let yen = s.totalScore * 50; 
        let scoreClass = s.totalScore >= 0 ? 'pos' : 'neg';

        tbodyHtml += `
            <tr>
                <td><b>${idx + 1}</b></td>
                <td><b>${name}</b></td>
                <td>${s.games}</td>
                <td>${winRate}</td>
                <td>${avgRank}</td>
                <td class="${scoreClass}">${s.totalScore > 0 ? '+' : ''}${s.totalScore.toFixed(1)}</td>
                <td class="${scoreClass}">${yen >= 0 ? '+' : ''}${yen.toLocaleString()}円</td>
            </tr>
        `;
    });

    document.getElementById("summary-table-body").innerHTML = tbodyHtml || `<tr><td colspan="7" class="empty-text">データなし</td></tr>`;

    updateSummaryChart(filteredRecords.map((_, idx) => `第${idx+1}局`), cumulativeTimeline);
}

// 通算グラフの描画（補助線を白い半透明に修正）
function updateSummaryChart(labels, cumulativeTimeline) {
    const ctx = document.getElementById('summaryChart').getContext('2d');
    const colorPalette = ['#ff8c00', '#3498db', '#2ecc71', '#e74c3c', '#9b59b6', '#1abc9c', '#f1c40f'];
    
    let datasets = Object.keys(cumulativeTimeline).map((name, idx) => ({
        label: name,
        data: cumulativeTimeline[name],
        borderColor: colorPalette[idx % colorPalette.length],
        backgroundColor: colorPalette[idx % colorPalette.length],
        borderWidth: 2,
        tension: 0.1
    }));

    if (appState.summaryChartInstance) appState.summaryChartInstance.destroy();

    appState.summaryChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { 
                    grid: { color: 'rgba(255, 255, 255, 0.25)' }, 
                    ticks: { color: '#ffffff' } 
                },
                y: { 
                    grid: { color: 'rgba(255, 255, 255, 0.25)' }, 
                    ticks: { color: '#ffffff' } 
                }
            },
            plugins: { legend: { position: 'bottom', labels: { color: '#e4e6eb' } } }
        }
    });
}

function renderPastDatesSelect() {
    const select = document.getElementById("past-dates-select");
    const currentDate = document.getElementById("target-date").value;
    
    let html = `<option value="">過去の対局日を選択...</option>`;
    appState.availableDates.forEach(dateStr => {
        let isSelected = dateStr === currentDate ? 'selected' : '';
        html += `<option value="${dateStr}" ${isSelected}>${dateStr}</option>`;
    });
    select.innerHTML = html;
}

function selectPastDate() {
    const select = document.getElementById("past-dates-select");
    if (select.value) {
        document.getElementById("target-date").value = select.value;
        fetchData();
    }
}

function renderPlayerInputs(dataToFill = null) {
    const mode = parseInt(document.getElementById("game-mode").value);
    localStorage.setItem('mahjong_mode', mode);

    const container = document.getElementById("players-container");
    let html = "";

    for (let i = 1; i <= mode; i++) {
        let pName = "";
        let pScore = "";
        
        if (dataToFill && dataToFill.players[i-1]) {
            pName = dataToFill.players[i-1].name;
            pScore = dataToFill.players[i-1].score;
        } else if (appState.lastUsedMembers[i-1]) {
            pName = appState.lastUsedMembers[i-1];
        }

        let isCustom = pName && !appState.cachedMembers.includes(pName);
        let optionsHtml = appState.cachedMembers.map(m => 
            `<option value="${m}" ${m === pName ? 'selected' : ''}>${m}</option>`
        ).join('');
        optionsHtml += `<option value="__custom__" ${isCustom ? 'selected' : ''}>✏️ その他（自由入力）</option>`;

        html += `
            <div class="player-row">
                <div class="name-wrapper">
                    <select id="member-select-${i}" onchange="toggleCustomInput(${i})">
                        ${optionsHtml}
                    </select>
                    <input type="text" id="name-custom-${i}" class="${isCustom ? '' : 'hidden'}" value="${isCustom ? pName : ''}" placeholder="名前を入力">
                </div>
                <input type="number" id="score-${i}" value="${pScore}" placeholder="P${i}のスコア">
            </div>
        `;
    }
    container.innerHTML = html;
}

function toggleCustomInput(i) {
    const select = document.getElementById(`member-select-${i}`);
    const customInput = document.getElementById(`name-custom-${i}`);
    if (select.value === "__custom__") {
        customInput.classList.remove("hidden");
        customInput.focus();
    } else {
        customInput.classList.add("hidden");
    }
}

function getPlayerName(i) {
    const select = document.getElementById(`member-select-${i}`);
    return select.value === "__custom__" ? (document.getElementById(`name-custom-${i}`).value || `ゲスト${i}`) : select.value;
}

function autoCalculateBlank() {
    const mode = parseInt(document.getElementById("game-mode").value);
    let blankIndex = -1, sumOthers = 0, blankCount = 0;

    for (let i = 1; i <= mode; i++) {
        const valStr = document.getElementById(`score-${i}`).value;
        if (valStr === "") {
            blankIndex = i;
            blankCount++;
        } else {
            sumOthers += parseFloat(valStr) || 0;
        }
    }

    if (blankCount !== 1) {
        alert("スコアが空欄の場所が1箇所だけになるようにしてください。");
        return;
    }
    document.getElementById(`score-${blankIndex}`).value = -sumOthers;
}

function renderHistoryAndChart() {
    const container = document.getElementById("history-container");
    document.getElementById("history-count").textContent = appState.dayRecords.length;
    
    if (appState.dayRecords.length === 0) {
        container.innerHTML = `<span class="empty-text">この日の対局データはまだありません</span>`;
        document.getElementById("total-text").innerHTML = "データなし";
        updateDailyChart([], {});
        return;
    }

    let totals = {};
    let cumulativeScores = {};
    let allMembers = new Set();
    let html = "";

    appState.dayRecords.forEach(rec => {
        for (let i = 0; i < rec.data.length; i += 2) {
            if (rec.data[i]) allMembers.add(rec.data[i]);
        }
    });
    allMembers.forEach(m => cumulativeScores[m] = []);

    appState.dayRecords.forEach((rec, idx) => {
        let details = [];
        let gameScores = {};

        for (let i = 0; i < rec.data.length; i += 2) {
            let pName = rec.data[i];
            let pScore = parseFloat(rec.data[i+1]) || 0;
            if (pName) {
                gameScores[pName] = pScore;
                details.push(`${pName}(<b>${pScore > 0 ? '+' : ''}${pScore}</b>)`);
                totals[pName] = (totals[pName] || 0) + pScore;
            }
        }

        allMembers.forEach(m => {
            let prevSum = cumulativeScores[m].length > 0 ? cumulativeScores[m][cumulativeScores[m].length - 1] : 0;
            cumulativeScores[m].push(prevSum + (gameScores[m] || 0));
        });

        html += `
            <div class="history-card">
                <div class="history-info">
                    <b>第${idx+1}戦 (${rec.mode})</b><br>${details.join(' / ')}
                </div>
                <div class="history-actions">
                    <button class="btn-edit" onclick="startEdit(${idx}, '${rec.id}', '${rec.mode}')">編集</button>
                    <button class="btn-delete" onclick="deleteRecord('${rec.id}', ${idx + 1})">削除</button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    let totalArr = Object.entries(totals).map(([name, score]) => {
        let yen = score * 50; 
        return `${name}: <b>${score > 0 ? '+' : ''}${score}</b> (${yen >= 0 ? '+' : ''}${yen}円)`;
    });
    document.getElementById("total-text").innerHTML = totalArr.join("<br>") || "データなし";

    updateDailyChart(appState.dayRecords.map((_, idx) => `第${idx+1}戦`), cumulativeScores);
}

// 日別グラフの描画（補助線を白い半透明に修正）
function updateDailyChart(labels, cumulativeScores) {
    const ctx = document.getElementById('scoreChart').getContext('2d');
    const colorPalette = ['#ff8c00', '#3498db', '#2ecc71', '#e74c3c', '#9b59b6', '#1abc9c'];
    
    let datasets = Object.keys(cumulativeScores).map((name, idx) => ({
        label: name,
        data: cumulativeScores[name],
        borderColor: colorPalette[idx % colorPalette.length],
        backgroundColor: colorPalette[idx % colorPalette.length],
        borderWidth: 2,
        tension: 0.1
    }));

    if (appState.dailyChartInstance) appState.dailyChartInstance.destroy();

    appState.dailyChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { 
                    grid: { color: 'rgba(255, 255, 255, 0.25)' }, 
                    ticks: { color: '#ffffff' } 
                },
                y: { 
                    grid: { color: 'rgba(255, 255, 255, 0.25)' }, 
                    ticks: { color: '#ffffff' } 
                }
            },
            plugins: { legend: { position: 'bottom', labels: { color: '#e4e6eb' } } }
        }
    });
}

function startEdit(arrayIdx, recordId, modeStr) {
    appState.editingId = recordId;
    const rec = appState.dayRecords[arrayIdx];
    
    document.getElementById("game-mode").value = modeStr.includes("3") ? 3 : 4;
    let parsedPlayers = [];
    for (let i = 0; i < rec.data.length; i += 2) {
        if(rec.data[i]) parsedPlayers.push({ name: rec.data[i], score: parseFloat(rec.data[i+1]) });
    }
    
    renderPlayerInputs({ players: parsedPlayers });

    document.getElementById("editing-target-num").textContent = arrayIdx + 1;
    document.getElementById("editing-banner").classList.remove("hidden");
    document.getElementById("submit-btn").textContent = "修正内容を上書き保存する";
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
    appState.editingId = null;
    document.getElementById("editing-banner").classList.add("hidden");
    document.getElementById("submit-btn").textContent = "この半チャンを送信する";
    renderPlayerInputs();
}

async function deleteRecord(recordId, displayNum) {
    if (!confirm(`第${displayNum}戦のデータを削除しますか？`)) return;

    try {
        const res = await fetch(GAS_URL, {
            method: "POST",
            body: JSON.stringify({ action: "delete", password: appState.password, id: recordId })
        });
        const result = await res.json();
        if (result.status === "success") {
            if (appState.editingId === recordId) cancelEdit();
            await fetchData();
        } else {
            alert("エラー: " + result.message);
        }
    } catch (e) {
        alert("通信に失敗しました");
    }
}

async function submitScore() {
    const mode = parseInt(document.getElementById("game-mode").value);
    const targetDate = document.getElementById("target-date").value;
    
    let players = [];
    appState.lastUsedMembers = []; 
    let totalCheck = 0;

    for (let i = 1; i <= mode; i++) {
        let name = getPlayerName(i);
        let scoreVal = document.getElementById(`score-${i}`).value;
        
        if (scoreVal === "") return alert(`P${i} (${name}) のスコアが入力されていません。`);
        
        let score = parseFloat(scoreVal);
        totalCheck += score;
        players.push({ name: name, score: score });
        appState.lastUsedMembers.push(name);
    }

    if (Math.abs(totalCheck) > 0.01) {
        if (!confirm(`スコアの合計が 0 になっていません（現在の合計: ${totalCheck}）。送信しますか？`)) return;
    }

    const msg = appState.editingId ? "修正内容を上書き保存しますか？" : `${targetDate} の対局結果を送信しますか？`;
    if (!confirm(msg)) return;

    try {
        let payload = {
            action: "save",
            password: appState.password,
            date: targetDate,
            mode: mode,
            players: players
        };
        if (appState.editingId) payload.id = appState.editingId;

        const res = await fetch(GAS_URL, {
            method: "POST",
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        
        if (result.status === "success") {
            localStorage.setItem('mahjong_last_players', JSON.stringify(appState.lastUsedMembers));
            if (appState.editingId) cancelEdit();
            await fetchData();
            for (let i = 1; i <= mode; i++) document.getElementById(`score-${i}`).value = "";
        } else {
            alert("エラー: " + result.message);
        }
    } catch (e) {
        alert("通信に失敗しました");
    }
}