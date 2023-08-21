// Function to show the current item
function showCurrentItem(category) {
    const categoryCarousel = document.querySelector(`.carousel.${category}`);
    categoryCarousel.querySelectorAll('.carousel-item').forEach((item, index) => {
        if (index === currentIndex[category]) {
            item.style.display = 'block';
        } else {
            item.style.display = 'none';
        }
    });
}

// Function to scroll the carousel
function scrollCarousel(button, category, direction) {
    currentIndex[category] += direction;
    const categoryCarousel = document.querySelector(`.carousel.${category}`);
    if (currentIndex[category] < 0) {
        currentIndex[category] = categoryCarousel.querySelectorAll('.carousel-item').length - 1;
    } else if (currentIndex[category] >= categoryCarousel.querySelectorAll('.carousel-item').length) {
        currentIndex[category] = 0;
    }
    showCurrentItem(category);
}

// Start the carousel by showing the first item for each category
const carouselCategories = document.querySelectorAll('.carousel');
let currentIndex = {};
carouselCategories.forEach(categoryCarousel => {
    const category = categoryCarousel.classList[1];
    currentIndex[category] = 0;
    showCurrentItem(category);
});

// Add event listeners to buttons for scrolling
document.querySelectorAll('.carousel-button').forEach(button => {
    const category = button.parentElement.querySelector('.carousel').classList[1];
    button.addEventListener('click', () => scrollCarousel(button, category, button.textContent === 'Previous' ? -1 : 1));
});

// Function to automatically scroll the carousel every 6 seconds
function autoScrollCarousel() {
    carouselCategories.forEach(categoryCarousel => {
        const category = categoryCarousel.classList[1];
        scrollCarousel(null, category, 1);
    });
}


// Set an interval to automatically scroll the carousel every 6 seconds
setInterval(autoScrollCarousel, 6000);

