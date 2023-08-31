const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const multer = require('multer');
const app = express();
const session = require('express-session');
const dotenv = require('dotenv');
const AWS = require('aws-sdk');
dotenv.config(); // Load environment variables from .env file

// Configure AWS SDK with your Bucketeer credentials
AWS.config.update({
    accessKeyId: process.env.BUCKETEER_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.BUCKETEER_AWS_SECRET_ACCESS_KEY,
    region: process.env.BUCKETEER_AWS_REGION,
});

app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true
}));
const upload = multer({
    storage: multer.memoryStorage(),
});

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/images');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});


// Directly use environment variables
const dbHost = process.env.DB_HOST;
const dbPort = process.env.DB_PORT || 3306; // Use 3306 as the default MySQL port
const dbUser = process.env.DB_USER;
const dbPassword = process.env.DB_PASS;
const dbName = process.env.DB_NAME;

// Configure MySQL Database Pool
const connection = mysql.createPool({
    host: dbHost,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    port: dbPort
});

// Connect to MySQL
connection.getConnection((err, conn) => {
    if (err) {
        console.error('Error connecting to the database: ' + err.stack);
        return;
    }
    console.log('Connected to the database!');
    conn.release(); // Release the connection
});

module.exports = connection;

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'));

function requireAuth(req, res, next) {
    if (req.session.authenticated) {
        next();
    } else {
        res.redirect('/login');
    }
}

connection.query('SELECT 1', (err, results) => {
    if (err) {
        console.error('Database connection error: ' + err.stack);
    } else {
        console.log('Database is connected.');
    }
});



app.get('/editRecipe/:id', requireAuth, (req, res) => {
    const recipeId = req.params.id;

    const sql = 'SELECT * FROM recipes WHERE id = ?';
    connection.query(sql, [recipeId], (err, results) => {
        if (err) {
            console.error('Error retrieving recipe: ' + err.stack);
            res.status(500).send('Error retrieving recipe.');
            return;
        }

        if (results.length === 0) {
            res.status(404).send('Recipe not found.');
            return;
        }

        const recipe = results[0];
        // Render the editRecipe.ejs template and pass the recipe data
        res.render('editRecipe', { recipe });
    });
});

app.post('/updateRecipe/:id', requireAuth, upload.single('newPhoto'), (req, res) => {
    const recipeId = req.params.id;
    const { title, ingredients, instructions, familySecrets, type, makes } = req.body;
    const userId = req.session.userId; // Extract user ID from the session

    // Check if a file was uploaded
    if (!req.file) {
        // No new photo uploaded, continue with existing image URL
        const sql = 'UPDATE recipes SET title=?, ingredients=?, instructions=?, family_secrets=?, type=?, userId=?, makes=? WHERE id=?';
        const params = [title, ingredients, instructions, familySecrets, type, userId, makes, recipeId];

        connection.query(sql, params, (err, result) => {
            if (err) {
                console.error('Error updating recipe: ' + err.stack);
                res.status(500).send('Error updating recipe.');
                return;
            }
            console.log('Recipe updated successfully!');
            res.redirect('/myRecipes');
        });
    } else {
        // New photo uploaded, save it to S3
        const fileBuffer = req.file.buffer;
        const fileName = Date.now() + '-' + req.file.originalname;

        // Define S3 upload parameters
        const params = {
            Bucket: process.env.BUCKETEER_BUCKET_NAME, // Use the Bucketeer bucket name
            Key: fileName, // File name in S3
            Body: fileBuffer, // File content
           
        };

        // Upload the file to S3
        s3.upload(params, (err, data) => {
            if (err) {
                console.error('Error uploading photo to S3: ' + err);
                res.status(500).send('Error updating recipe.');
                return;
            }

            // Update the recipe in the database with the S3 URL
            const newImageUrl = data.Location;
            const sql = 'UPDATE recipes SET title=?, ingredients=?, instructions=?, family_secrets=?, type=?, image_url=?, userId=?, makes=? WHERE id=?';
            const params = [title, ingredients, instructions, familySecrets, type, newImageUrl, userId, makes, recipeId];

            connection.query(sql, params, (err, result) => {
                if (err) {
                    console.error('Error updating recipe: ' + err.stack);
                    res.status(500).send('Error updating recipe.');
                    return;
                }
                console.log('Recipe updated successfully!');
                res.redirect('/myRecipes');
            });
        });
    }
});


app.get('/search', async (req, res) => {
    try {
        const query = req.query.query;
        const sql = 'SELECT * FROM recipes WHERE title LIKE ?';
        connection.query(sql, [`%${query}%`], (err, results) => {
            if (err) {
                console.error('Error retrieving search results: ' + err.stack);
                res.status(500).send('Error retrieving search results.');
                return;
            }

            // Define the 'categories' variable here
            const categories = [
                'Appetizers', 'Breads', 'Soups', 'Pasta and Sauces',
                'Entrées', 'Veggies', 'Cakes', 'Pies', 'Cookies'
            ];

            // Pass the 'categories' variable to the template
            res.render('searchResults', { searchResults: results, categories: categories });
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('An error occurred while processing your search query.');
    }
});

app.get('/', (req, res) => {
    const sql = 'SELECT * FROM recipes';
    connection.query(sql, (err, results) => {
        if (err) {
            console.error('Error retrieving recipes: ' + err.stack);
            res.status(500).send('Error retrieving recipes.');
            return;
        }

        results.forEach(recipe => {
            recipe.ingredients = recipe.ingredients.split('|');
            recipe.instructions = recipe.instructions.split('|');
        });

        const categories = [
            'Appetizers', 'Breads', 'Soups', 'Pasta and Sauces',
            'Entrées', 'Veggies', 'Cakes', 'Pies', 'Cookies'
        ];
        const categorizedRecipes = {};
        categories.forEach(category => {
            categorizedRecipes[category] = results.filter(recipe => recipe.type === category);
        });

        const showAddRecipeLink = req.session.authenticated;
        const showMyRecipesLink = req.session.authenticated;

        const firstName = req.session.authenticated ? req.session.firstName : '';
        const lastName = req.session.authenticated ? req.session.lastName : '';

        res.render('home', {
            categories,
            categorizedRecipes,
            authenticated: req.session.authenticated,
            userId: req.session.userId,
            showAddRecipeLink,
            showMyRecipesLink,
            firstName,
            lastName
        });
    });
});

app.get('/recipe/:id', (req, res) => {
    const recipeId = req.params.id;

    const sql = 'SELECT * FROM recipes WHERE id = ?';
    connection.query(sql, [recipeId], (err, results) => {
        if (err) {
            console.error('Error retrieving recipe: ' + err.stack);
            res.status(500).send('Error retrieving recipe.');
            return;
        }

        if (results.length === 0) {
            res.status(404).send('Recipe not found.');
            return;
        }

        const recipe = results[0];
        recipe.ingredients = recipe.ingredients.split('|').map(ingredient => `• ${ingredient.trim()}`).join('<br>');
        recipe.instructions = recipe.instructions.split('|');

        const categories = [
            'Appetizers', 'Breads', 'Soups', 'Pasta and Sauces',
            'Entrées', 'Veggies', 'Cakes', 'Pies', 'Cookies'
        ];

        res.render('recipe-details', { recipe, categories }); // Pass the categories array
    });
});
app.get('/category/:category', (req, res) => {
    const category = req.params.category.replace(/-/g, ' '); // Replace hyphens with spaces
    const sql = 'SELECT * FROM recipes WHERE type = ?';
    connection.query(sql, [category], (err, results) => {
        if (err) {
            console.error('Error fetching recipes: ' + err.stack);
            res.status(500).send('Error fetching recipes.');
            return;
        }

        const defaultImageUrl = '/images/default-photo.jpg';
        const modifiedCategory = category.charAt(0).toUpperCase() + category.slice(1);

        const categories = [
            'Appetizers', 'Breads', 'Soups', 'Pasta and Sauces',
            'Entrées', 'Veggies', 'Cakes', 'Pies', 'Cookies'
        ];

        res.render('recipesByCategory', { recipes: results, category: modifiedCategory, defaultImageUrl: defaultImageUrl, categories: categories });
    });
});

app.get('/register', (req, res) => {
    res.render('register', { errorMessage: req.session.errorMessage });
    req.session.errorMessage = undefined;
});

app.post('/register', (req, res) => {
    const { email, password, firstName, lastName } = req.body;
    const emailCheckSql = 'SELECT * FROM nf9fk46l4rajefsl.users WHERE email = ?';
    connection.query(emailCheckSql, [email], (emailErr, emailResults) => {
        if (emailErr) {
            console.error('Error checking email: ' + emailErr.stack);
            res.status(500).send('Error checking email.');
            return;
        }

        if (emailResults.length > 0) {
            req.session.errorMessage = 'Email already registered.';
            res.redirect('/register');
            return;
        }

        const insertSql = 'INSERT INTO nf9fk46l4rajefsl.users (email, password, first_name, last_name) VALUES (?, ?, ?, ?)';
        connection.query(insertSql, [email, password, firstName, lastName], (insertErr, result) => {
            if (insertErr) {
                console.error('Error registering user: ' + insertErr.stack);
                res.status(500).send('Error registering user.');
                return;
            }
            console.log('User registered successfully!');

            // Log the user in after successful registration
            req.session.authenticated = true;
            req.session.userId = result.insertId;
            req.session.firstName = firstName;
            req.session.lastName = lastName;

            res.redirect('/');
        });
    });
});

app.get('/login', (req, res) => {
    res.render('login', { errorMessage: req.session.errorMessage });
    req.session.errorMessage = undefined;
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const sql = 'SELECT * FROM nf9fk46l4rajefsl.users WHERE email = ? AND password = ?';
    connection.query(sql, [email, password], (err, results) => {
        if (err) {
            console.error('Error logging in: ' + err.stack);
            res.status(500).send('Error logging in.');
            return;
        }

        if (results.length > 0) {
            req.session.authenticated = true;
            req.session.userId = results[0].id;
            req.session.firstName = results[0].first_name;
            req.session.lastName = results[0].last_name;
            res.redirect('/');
        } else {
            req.session.errorMessage = 'Invalid email or password';
            res.redirect('/');
        }
        console.log(`Email: ${email}, Password: ${password}`);
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session: ' + err.stack);
            res.status(500).send('Error logging out.');
            return;
        }
        res.redirect('/');
    });
});

app.get('/addRecipe', requireAuth, (req, res) => {
    res.render('addRecipe', { authenticated: req.session.authenticated });
});

app.post('/addRecipe', requireAuth, upload.single('photo'), (req, res) => {
    const { title, ingredients, instructions, familySecrets, type, makes } = req.body;
    const userId = req.session.userId;

    // Initialize AWS SDK and S3 object
    const AWS = require('aws-sdk');
    AWS.config.update({
        accessKeyId: process.env.BUCKETEER_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.BUCKETEER_AWS_SECRET_ACCESS_KEY,
        region: process.env.BUCKETEER_AWS_REGION,
    });
    const s3 = new AWS.S3();

    // Check if a file was uploaded
    if (!req.file) {
        // No photo uploaded, use a default image URL
        const image_url = '/images/default-photo.jpg';
        const sql = 'INSERT INTO recipes (title, ingredients, instructions, family_secrets, type, image_url, userId, makes, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

        // Fetch user's first and last name here if needed
        const firstName = ''; // Replace with your logic to fetch the first name
        const lastName = '';  // Replace with your logic to fetch the last name

        const params = [title, ingredients, instructions, familySecrets, type, image_url, userId, makes, `${firstName} ${lastName}`];

        // Insert the recipe into the database
        connection.query(sql, params, (err, result) => {
            if (err) {
                console.error('Error adding recipe: ' + err.stack);
                res.status(500).send('Error adding recipe.');
                return;
            }
            console.log('Recipe added successfully!');
            res.redirect('/');
        });
    } else {
        // Photo uploaded, save it to S3
        const fileBuffer = req.file.buffer;
        const fileName = Date.now() + '-' + req.file.originalname;

        // Define S3 upload parameters
        const params = {
            Bucket: process.env.BUCKETEER_BUCKET_NAME, // Use the Bucketeer bucket name
            Key: "public/" +fileName, // File name in S3
            Body: fileBuffer, // File content
            acl: 'public'
            
        };

        // Upload the file to S3
        s3.upload(params, (err, data) => {
            if (err) {
                console.error('Error uploading photo to S3: ' + err);
                res.status(500).send('Error adding recipe.');
                return;
            } 
            console.log('photo loaded successfully', data);

            // Update the recipe in the database with the S3 URL
            const image_url = data.Location; // Use the S3 URL

            const sql = 'INSERT INTO recipes (title, ingredients, instructions, family_secrets, type, image_url, userId, makes, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

            // Fetch user's first and last name here if needed
            const firstName = ''; // Replace with your logic to fetch the first name
            const lastName = '';  // Replace with your logic to fetch the last name

            const params = [title, ingredients, instructions, familySecrets, type, image_url, userId, makes, `${firstName} ${lastName}`];

            // Insert the recipe into the database
            connection.query(sql, params, (err, result) => {
                if (err) {
                    console.error('Error adding recipe: ' + err.stack);
                    res.status(500).send('Error adding recipe.');
                    return;
                }
                console.log('Recipe added successfully!');
                res.redirect('/');
            });
        });
    }
});

app.get('/myRecipes', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const sql = `
        SELECT recipes.*, users.first_name, users.last_name
        FROM recipes
        INNER JOIN users ON recipes.userId = users.id
        WHERE userId = ?
    `;
    connection.query(sql, [userId], (err, results) => {
        if (err) {
            console.error('Error retrieving recipes: ' + err.stack);
            res.status(500).send('Error retrieving recipes.');
            return;
        }
        res.render('myRecipes', { recipes: results });
    });
});

// ... (Other routes and setup)



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}.`);
});
