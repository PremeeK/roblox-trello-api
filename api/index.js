// api/index.js
require('dotenv').config(); // Načte proměnné prostředí z .env

const express = require('express');
const fetch = require('node-fetch');
const app = express();

const TRELLO_API_KEY = process.env.TRELLO_API_KEY;
const TRELLO_API_TOKEN = process.env.TRELLO_API_TOKEN;
const TRELLO_BOARD_ID = process.env.TRELLO_BOARD_ID;

app.use(express.json());

// Pomocná funkce pro parsování popisu karty
function parseCardDescription(description) {
    const hostRegex = /Host:\s*(.+)/i;
    const coHostRegex = /Co-Host:\s*(.+)/i;

    const hostMatch = description.match(hostRegex);
    const coHostMatch = description.match(coHostRegex);

    return {
        host: hostMatch ? hostMatch[1].trim() : 'Neznámý',
        coHost: coHostMatch ? coHostMatch[1].trim() : 'Neznámý'
    };
}

// Funkce pro získání názvu seznamu
async function getListName(listId) {
    const listUrl = `https://api.trello.com/1/lists/${listId}?key=${TRELLO_API_KEY}&token=${TRELLO_API_TOKEN}`;
    try {
        const response = await fetch(listUrl);
        const data = await response.json();
        return data.name;
    } catch (error) {
        console.error(`Chyba při získávání názvu seznamu ${listId}:`, error);
        return 'Neznámý seznam';
    }
}

app.get('/api/trello-sessions', async (req, res) => {
    if (!TRELLO_API_KEY || !TRELLO_API_TOKEN || !TRELLO_BOARD_ID) {
        return res.status(500).json({ error: 'Některé proměnné prostředí nejsou nastaveny.' });
    }

    try {
        // Získáme všechny seznamy na desce
        const listsUrl = `https://api.trello.com/1/boards/${TRELLO_BOARD_ID}/lists?key=${TRELLO_API_KEY}&token=${TRELLO_API_TOKEN}`;
        const listsResponse = await fetch(listsUrl);
        const listsData = await listsResponse.json();

        // Najdeme seznam, který nás zajímá (např. podle jména "Nadcházející tréninky")
        // Můžete to upravit, pokud chcete získávat karty ze všech seznamů nebo konkrétních ID seznamů
        const targetList = listsData.find(list => list.name === "Nadcházející tréninky"); // Můžete změnit název seznamu

        if (!targetList) {
            return res.status(404).json({ error: 'Seznam "Nadcházející tréninky" nebyl nalezen na desce.' });
        }

        // Získáme karty z nalezeného seznamu
        const cardsUrl = `https://api.trello.com/1/lists/${targetList.id}/cards?key=${TRELLO_API_KEY}&token=${TRELLO_API_TOKEN}&fields=name,desc,due,labels,idList`;
        const cardsResponse = await fetch(cardsUrl);
        const cardsData = await cardsResponse.json();

        const sessions = await Promise.all(cardsData.map(async (card, index) => {
            const { host, coHost } = parseCardDescription(card.desc);
            const statusLabel = card.labels.length > 0 ? card.labels[0].name : 'N/A'; // Vezme první štítek
            const listName = await getListName(card.idList);

            return {
                id: card.id,
                order: index + 1, // Pořadí karty v seznamu (od 1)
                name: card.name,
                status: statusLabel,
                dueDate: card.due, // Datum splatnosti z Trello (ISO 8601 formát)
                host: host,
                coHost: coHost,
                listName: listName // Pro informaci, ze kterého seznamu karta je
            };
        }));

        // Seřadíme relace podle data, pokud je to potřeba (Trello API vrací karty v pořadí, jak jsou na desce)
        sessions.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

        res.status(200).json(sessions);

    } catch (error) {
        console.error('Chyba při získávání dat z Trello:', error);
        res.status(500).json({ error: 'Interní chyba serveru při získávání dat z Trello.' });
    }
});

// Pro lokální testování (Vercel toto nepotřebuje, ale je to dobré mít pro vývoj)
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server běží na http://localhost:${PORT}`);
        console.log('Trello API Key:', TRELLO_API_KEY ? 'Set' : 'Not Set');
        console.log('Trello API Token:', TRELLO_API_TOKEN ? 'Set' : 'Not Set');
        console.log('Trello Board ID:', TRELLO_BOARD_ID ? 'Set' : 'Not Set');
    });
}

module.exports = app; // Export pro Vercel