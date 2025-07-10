import 'dotenv/config';

import express from 'express';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

const TRELLO_API_KEY = process.env.TRELLO_API_KEY;
const TRELLO_API_TOKEN = process.env.TRELLO_API_TOKEN;
const TRELLO_BOARD_ID = process.env.TRELLO_BOARD_ID;

app.use(express.json());

function parseCardDescription(description) {
    const hostRegex = /Host:\s*(.+)/i;
    const coHostRegex = /Co-Host:\s*(.+)/i;

    const hostMatch = description.match(hostRegex);
    const coHostMatch = description.match(coHostRegex);

    return {
        host: hostMatch ? hostMatch[1].trim() : 'N/A',
        coHost: coHostMatch ? coHostMatch[1].trim() : 'N/A'
    };
}

async function getListName(listId) {
    const listUrl = `https://api.trello.com/1/lists/${listId}?key=${TRELLO_API_KEY}&token=${TRELLO_API_TOKEN}`;
    try {
        const response = await fetch(listUrl);
        if (!response.ok) {
            console.error(`Error while getting list ${listId}: ${response.status} ${response.statusText}`);
            return 'Unknown list';
        }
        const data = await response.json();
        return data.name;
    } catch (error) {
        console.error(`Error while getting list ${listId}:`, error);
        return 'Unknown list';
    }
}

app.get('/api/trello-sessions', async (req, res) => {
    if (!TRELLO_API_KEY || !TRELLO_API_TOKEN || !TRELLO_BOARD_ID) {
        console.error('SERVER ERROR: Some strings are not set!');
        return res.status(500).json({ error: 'Some strings are not set on the server.' });
    }

    try {
        const listsUrl = `https://api.trello.com/1/boards/${TRELLO_BOARD_ID}/lists?key=${TRELLO_API_KEY}&token=${TRELLO_API_TOKEN}`;
        const listsResponse = await fetch(listsUrl);

        if (!listsResponse.ok) {
            console.error(`Chyba při získávání seznamů z Trello: ${listsResponse.status} ${listsResponse.statusText}`);
            const errorText = await listsResponse.text();
            console.error('Trello API response error:', errorText);
            return res.status(listsResponse.status).json({ error: `Error while getting the list from trello: ${listsResponse.statusText}`, details: errorText });
        }
        const listsData = await listsResponse.json();

        const targetList = listsData.find(list => list.name === "Sessions");

        if (!targetList) {
            console.error('SERVER ERROR: The list "Sessions" has not been found on the board.');
            return res.status(404).json({ error: 'The list "Sessions" has not been found on the board. Check the ID & the name of the board.' });
        }

        const cardsUrl = `https://api.trello.com/1/lists/${targetList.id}/cards?key=${TRELLO_API_KEY}&token=${TRELLO_API_TOKEN}&fields=name,desc,due,labels,idList`;
        const cardsResponse = await fetch(cardsUrl);

        if (!cardsResponse.ok) {
            console.error(`Error while getting cards from Trello: ${cardsResponse.status} ${cardsResponse.statusText}`);
            const errorText = await cardsResponse.text();
            console.error('Trello API response error:', errorText);
            return res.status(cardsResponse.status).json({ error: `Error while getting cards from Trello: ${cardsResponse.statusText}`, details: errorText });
        }
        const cardsData = await cardsResponse.json();

        const sessions = await Promise.all(cardsData.map(async (card, index) => {
            const { host, coHost } = parseCardDescription(card.desc);

            const isJoinable = card.labels.some(label => label.name.toUpperCase() === "JOINABLE");

            const visibleLabels = card.labels.filter(label => label.name.toUpperCase() !== "JOINABLE");
            const displayStatusLabel = visibleLabels.length > 0 ? visibleLabels[0].name : 'N/A';

            const listName = await getListName(card.idList);

            return {
                id: card.id,
                order: index + 1,
                name: card.name,
                status: displayStatusLabel,
                dueDate: card.due,
                host: host,
                coHost: coHost,
                listName: listName,
                isJoinable: isJoinable
            };
        }));

        sessions.sort((a, b) => {
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(a.dueDate) - new Date(b.dueDate);
        });

        res.status(200).json(sessions);

    } catch (error) {
        console.error('SERVER ERROR: Inter error while getting the data from Trello:', error);
        res.status(500).json({ error: 'Inter error while trying to manage the order.', details: error.message });
    }
});

export default app;
