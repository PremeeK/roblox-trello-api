// api/index.mjs

// Načtení proměnných prostředí z .env souboru.
// V ES modulech se pro dotenv často používá 'dotenv/config',
// který automaticky načte .env. Pokud to nefunguje, použij import dotenv from 'dotenv'; dotenv.config();
import 'dotenv/config'; 

// Import potřebných modulů pomocí ES Modules syntaxe
import express from 'express';
import fetch from 'node-fetch'; // Nyní by to mělo fungovat s novějšími verzemi node-fetch
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Získání __dirname (alternativa pro ES Modules, protože __dirname není přímo dostupné)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Načtení proměnných prostředí.
// Vercel je načítá automaticky z konfigurace projektu, takže .env se použije jen lokálně.
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
        if (!response.ok) {
            console.error(`Chyba při získávání názvu seznamu ${listId}: ${response.status} ${response.statusText}`);
            return 'Neznámý seznam';
        }
        const data = await response.json();
        return data.name;
    } catch (error) {
        console.error(`Chyba při získávání názvu seznamu ${listId}:`, error);
        return 'Neznámý seznam';
    }
}

// Hlavní API endpoint pro získání Trello sessions
app.get('/api/trello-sessions', async (req, res) => {
    // Kontrola, zda jsou proměnné prostředí nastaveny
    if (!TRELLO_API_KEY || !TRELLO_API_TOKEN || !TRELLO_BOARD_ID) {
        console.error('SERVER ERROR: Některé proměnné prostředí nejsou nastaveny!');
        return res.status(500).json({ error: 'Některé proměnné prostředí nejsou nastaveny na serveru.' });
    }

    try {
        // Získáme všechny seznamy na desce
        const listsUrl = `https://api.trello.com/1/boards/${TRELLO_BOARD_ID}/lists?key=${TRELLO_API_KEY}&token=${TRELLO_API_TOKEN}`;
        const listsResponse = await fetch(listsUrl);
        
        if (!listsResponse.ok) {
            console.error(`Chyba při získávání seznamů z Trello: ${listsResponse.status} ${listsResponse.statusText}`);
            // Zkusíme vrátit podrobnější chybovou zprávu z Trello API, pokud je dostupná
            const errorText = await listsResponse.text();
            console.error('Trello API response error:', errorText);
            return res.status(listsResponse.status).json({ error: `Chyba při získávání seznamů z Trello: ${listsResponse.statusText}`, details: errorText });
        }
        const listsData = await listsResponse.json();

        // Najdeme seznam, který nás zajímá (např. podle jména "Nadcházející tréninky")
        // Ujisti se, že se název PŘESNĚ shoduje s názvem tvého seznamu na Trello desce
        const targetList = listsData.find(list => list.name === "Nadcházející tréninky"); 

        if (!targetList) {
            console.error('SERVER ERROR: Seznam "Nadcházející tréninky" nebyl nalezen na desce.');
            return res.status(404).json({ error: 'Seznam "Nadcházející tréninky" nebyl nalezen na desce. Zkontrolujte název a ID desky.' });
        }

        // Získáme karty z nalezeného seznamu
        const cardsUrl = `https://api.trello.com/1/lists/${targetList.id}/cards?key=${TRELLO_API_KEY}&token=${TRELLO_API_TOKEN}&fields=name,desc,due,labels,idList`;
        const cardsResponse = await fetch(cardsUrl);

        if (!cardsResponse.ok) {
            console.error(`Chyba při získávání karet z Trello: ${cardsResponse.status} ${cardsResponse.statusText}`);
            const errorText = await cardsResponse.text();
            console.error('Trello API response error:', errorText);
            return res.status(cardsResponse.status).json({ error: `Chyba při získávání karet z Trello: ${cardsResponse.statusText}`, details: errorText });
        }
        const cardsData = await cardsResponse.json();

        const sessions = await Promise.all(cardsData.map(async (card, index) => {
            const { host, coHost } = parseCardDescription(card.desc);
            // Vezme první štítek. Pokud chcete více, upravte logiku.
            const statusLabel = card.labels.length > 0 ? card.labels[0].name : 'N/A'; 
            
            // getListName je volán asynchronně a je potřeba ho awaitovat
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
        sessions.sort((a, b) => {
            // Zajistíme, že karty bez dueDate jsou na konci
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(a.dueDate) - new Date(b.dueDate);
        });

        res.status(200).json(sessions);

    } catch (error) {
        console.error('SERVER ERROR: Interní chyba serveru při získávání dat z Trello:', error);
        res.status(500).json({ error: 'Interní chyba serveru při zpracování požadavku.', details: error.message });
    }
});

// Export aplikace pro Vercel Serverless Function.
// V ES modules se pro export default používá 'export default'.
export default app;

// Poznámka: Pro lokální testování (není spuštěno Vercel serverless funkcí):
// Můžeš přidat sekci pro lokální spuštění, ale Vercel tuto část ignoruje.
// if (process.env.NODE_ENV !== 'production') {
//     const PORT = process.env.PORT || 3000;
//     app.listen(PORT, () => {
//         console.log(`Server běží na http://localhost:${PORT}`);
//     });
// }
