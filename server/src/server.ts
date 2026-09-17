// This should always be the first import!
import './load-env-vars.js';

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { connectToDatabase } from './database.js';

const app = express();
const port = process.env.PORT;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

try {
    await connectToDatabase(process.env.DATABASE_URI);
    console.log('Connected to database!');
} catch (error) {
    const uri = (process.env.DATABASE_URI ?? '').replace(/\/\/[^@/]+@/, '//***:***@');
    const reason = error instanceof Error ? error.message : String(error);

    console.error(`
    Unable to connect to MongoDB${uri ? ` at ${uri}` : ''}.

      • Local database not running?   npm run db:start && npm run db:seed
      • Using a local mongod?         check the host and port in server/.env
      • Using Atlas?                  check DATABASE_URI, the IP allowlist, the credentials
      • Wrong database name?          DATABASE_NAME in server/.env (sample data: "library")

    ${reason}
`);
    process.exit(1);
}

app.get('/', (_, res) => res.sendStatus(200));

app.use('/authors', (await import('./routes/authors.js')).default);
app.use('/books', (await import('./routes/books.js')).default);
app.use('/users', (await import('./routes/users.js')).default);
app.use('/books/:bookId/reviews', (await import('./routes/reviews.js')).default);
app.use('/reservations', (await import('./routes/reservations.js')).default);
app.use('/borrow', (await import('./routes/borrows.js')).default);

app.use(function (err, req, res, next) {
    if (err.name === 'UnauthorizedError') {
        res.status(401).send({message: 'Invalid Token'});
    } else {
        next(err);
    }
});

app.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
});
