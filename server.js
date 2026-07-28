import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post('/api/generate-event', async (req, res) => {
    const { player, type, context, gameState } = req.body;

    const systemInstruction = `You are an elite multi-persona football governance and media machine consisting of an aggressive Sky Sports Investigative Journalist, the FA Disciplinary Committee, and the FIFA Board.
    You must evaluate events using strict 2026/27 rule updates:
    1. Automatic multi-game bans for covering mouths to mask verbal insults.
    2. Immediate card sanctions for taking over 5 seconds on goal kicks or 10 seconds on substitutions.
    3. Automatic match forfeits if a manager pulls their team off the pitch in protest.
    
    You must return a valid JSON object strictly containing these exact keys:
    - "mediaHeadline": A punchy Sky Sports breaking news headline.
    - "newsReport": A dramatic investigative report covering the incident.
    - "officialRuling": The final verdict and sanction decreed by the FA/FIFA Board.`;

    const comp = gameState.competitions || {};
    const prompt = `Evaluate the following football club incident in Season ${gameState.season}, Week ${gameState.week}:
    Competition Context: League: ${comp.league || 'N/A'} | FA Cup: ${comp.cup || 'N/A'} | Europe: ${comp.europe || 'N/A'}
    Player Name: ${player.name}
    Position: ${player.position}
    Personality Trait: ${player.trait}
    Incident Type: ${type}
    Context Details: ${context}`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                responseMimeType: 'application/json'
            }
        });

        const resultJson = JSON.parse(response.text);
        res.json(resultJson);
    } catch (error) {
        console.error('Gemini API Error:', error);
        res.status(500).json({
            mediaHeadline: "SKY SPORTS BREAKING: FA Inquiry Delayed",
            newsReport: "Network interference prevented immediate transmission of disciplinary telemetry.",
            officialRuling: "Case deferred to next weekly review session."
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`FM 30-Year PWA Backend Server running on port ${PORT}`);
});