document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Element References ---
    const htmlCodeTextArea = document.getElementById('htmlCode');
    const previewFrame = document.getElementById('previewFrame');
    const renderButton = document.getElementById('renderButton');
    const syncButton = document.getElementById('syncButton');
    const downloadButton = document.getElementById('downloadButton');
    const messageBox = document.getElementById('messageBox');
    const editorToolbar = document.getElementById('editorToolbar');

    // Panel and Splitter for resizing
    const leftPanel = document.getElementById('leftPanel');
    const rightPanel = document.getElementById('rightPanel');
    const splitter = document.getElementById('splitter');
    const appContainer = document.getElementById('app-container');

    // Toolbar buttons
    const boldBtn = document.querySelector('[data-command="bold"]');
    const italicBtn = document.querySelector('[data-command="italic"]');
    const underlineBtn = document.querySelector('[data-command="underline"]');
    const strikeThroughBtn = document.querySelector('[data-command="strikeThrough"]');
    const superscriptBtn = document.querySelector('[data-command="superscript"]');
    const subscriptBtn = document.querySelector('[data-command="subscript"]');
    const unorderedListBtn = document.querySelector('[data-command="insertUnorderedList"]');
    const orderedListBtn = document.querySelector('[data-command="insertOrderedList"]');
    const fontColorPicker = document.getElementById('fontColorPicker');
    const fontBgColorPicker = document.getElementById('fontBgColorPicker');
    const divBgColorPicker = document.getElementById('divBgColorPicker');
    const insertLinkBtn = document.getElementById('insertLinkBtn');
    const insertImageBtn = document.getElementById('insertImageBtn');
    const clearFormatBtn = document.getElementById('clearFormatBtn');
    const fontSizeSelect = document.getElementById('fontSizeSelect');
    const fontFamilySelect = document.getElementById('fontFamilySelect'); // New font family select

    // Modals
    const linkModal = document.getElementById('linkModal');
    const imageModal = document.getElementById('imageModal');
    const closeButtons = document.querySelectorAll('.modal .close-button');
    const confirmLinkBtn = document.getElementById('confirmLinkBtn');
    const confirmImageBtn = document.getElementById('confirmImageBtn');
    const linkURLInput = document.getElementById('linkURL');
    const linkTextInput = document.getElementById('linkText');
    const imageURLInput = document.getElementById('imageURL');

    let iframeDoc; // Reference to the iframe's document
    let currentRange = null; // Store selection range for modal interactions

    // --- Google Fonts List (a selection of diverse open-source fonts) ---
    const googleFonts = [
        "Arial", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Times New Roman", // Common web safe fonts
        "Open Sans", "Roboto", "Lato", "Montserrat", "Inter", "Poppins", "Ubuntu", "Nunito", "Raleway", // Sans-serif
        "Merriweather", "Playfair Display", "Lora", "Crimson Text", "Libre Baskerville", "EB Garamond", "Bitter", // Serif
        "Oswald", "Bebas Neue", "Anton", "Fjalla One", "Staatliches", // Display/Condensed
        "Dancing Script", "Indie Flower", "Kalam", "Permanent Marker", "Shadows Into Light", "Pacifico", "Architects Daughter", "Lobster", "Courgette", "Tangerine", // Script/Handwriting
        "Fira Sans", "PT Sans", "Source Sans 3", "Work Sans", "Dosis", "Exo 2", "Heebo", "IBM Plex Sans", "Josefin Sans", "Kanit", "Mada", "Manrope", "Martel", "Merriweather Sans", "Mukta", "Noto Sans", "Oxygen", "Questrial", "Quicksand", "Rubik", "Slabo 27px", "Space Grotesk", "Sora", "Spectral", "Spline Sans", "Syne", "Tenor Sans", "Titillium Web", "Varela Round", "Zilla Slab", // More modern/diverse sans-serif & serif
        "Chakra Petch", "DotGothic16", "Press Start 2P", "Comfortaa", "Orbitron", "Overpass", "Rajdhani", "Secular One", "Sofia Sans", "Solway", "Texturina", "Trirong", "Vollkorn", "Volkhov", "Xanh Mono", // Unique/Experimental
        "Amatic SC", "Arimo", "Asap", "Barlow", "Blinker", "Catamaran", "Cousine", "Encode Sans", "Exo", "Faustina", "Gelasio", "IBM Plex Mono", "Inconsolata", "Karla", "Nanum Gothic", "Old Standard TT", "Patua One", "Philosopher", "Proza Libre", "Red Hat Display", "Sarabun", "Special Elite"
    ];


    // --- Utility Functions ---

    /**
     * Displays a temporary message to the user.
     * @param {string} message - The message to display.
     * @param {number} duration - How long the message should be visible in milliseconds.
     */
    function showMessage(message, duration = 3000) {
        messageBox.textContent = message;
        messageBox.classList.add('show');
        setTimeout(() => {
            messageBox.classList.remove('show');
        }, duration);
    }

    /**
     * Executes a document.execCommand on the iframe's content.
     * @param {string} command - The command to execute (e.g., 'bold', 'insertUnorderedList').
     * @param {string} [value=null] - The value for the command (e.g., color hex code, link URL).
     */
    function executeCommand(command, value = null) {
        if (!iframeDoc) {
            showMessage('Preview not loaded. Render HTML first.', 3000);
            return;
        }
        try {
            // Focus the iframe's content to ensure execCommand works on its document
            previewFrame.contentWindow.focus();
            iframeDoc.execCommand(command, false, value);
            // After command, sync the content back to the textarea (debounced)
            syncFromPreviewDebounced();
            updateToolbarState(); // Update toolbar state immediately after command
            showMessage(`${command.replace(/([A-Z])/g, ' $1').trim()} applied!`, 1500); // Nicer message
        } catch (error) {
            console.error(`Error executing command '${command}':`, error);
            showMessage(`Error applying ${command.replace(/([A-Z])/g, ' $1').trim()}.`, 3000);
        }
    }

    /**
     * Opens a given modal.
     * @param {HTMLElement} modalElement - The modal DOM element.
     */
    function openModal(modalElement) {
        modalElement.classList.add('show');
        // Store current selection range when modal opens
        if (iframeDoc && previewFrame.contentWindow.getSelection().rangeCount > 0) {
            currentRange = previewFrame.contentWindow.getSelection().getRangeAt(0);
        }
    }

    /**
     * Closes a given modal.
     * @param {HTMLElement} modalElement - The modal DOM element.
     */
    function closeModal(modalElement) {
        modalElement.classList.remove('show');
        // Clear input fields when closing
        const inputs = modalElement.querySelectorAll('input[type="text"], input[type="url"]');
        inputs.forEach(input => input.value = '');
        currentRange = null; // Clear stored range
    }

    /**
     * Sets the active state of toolbar buttons based on selection.
     * Uses queryCommandState and queryCommandValue.
     */
    function updateToolbarState() {
        if (!iframeDoc || !previewFrame.contentWindow) return; // Ensure iframe is ready

        const selection = previewFrame.contentWindow.getSelection();
        if (!selection || selection.rangeCount === 0) {
            // No selection, deactivate all relevant buttons and reset values
            editorToolbar.querySelectorAll('.toolbar-button').forEach(btn => btn.classList.remove('active'));
            fontColorPicker.value = '#000000';
            fontBgColorPicker.value = '#FFFFFF';
            divBgColorPicker.value = '#FFFFFF';
            fontSizeSelect.value = ''; // Reset font size selection
            fontFamilySelect.value = ''; // Reset font family selection
            return;
        }

        const buttons = editorToolbar.querySelectorAll('[data-command]');
        buttons.forEach(button => {
            const command = button.dataset.command;
            try {
                if (iframeDoc.queryCommandState(command)) {
                    button.classList.add('active');
                } else {
                    button.classList.remove('active');
                }
            } catch (e) {
                button.classList.remove('active');
            }
        });

        const rgbToHex = (rgb) => {
            if (!rgb || rgb.includes('transparent')) return '#000000';
            if (rgb.startsWith('#')) return rgb;
            const parts = rgb.match(/\d+/g);
            if (!parts || parts.length < 3) return '#000000';
            return '#' + parts.slice(0, 3).map(x => {
                const hex = parseInt(x).toString(16);
                return hex.length === 1 ? '0' + hex : hex;
            }).join('');
        };

        try {
            let foreColor = iframeDoc.queryCommandValue('foreColor');
            let backColor = iframeDoc.queryCommandValue('backColor');
            let highlightColor = iframeDoc.queryCommandValue('hiliteColor'); // For highlight

            fontColorPicker.value = rgbToHex(foreColor) || '#000000';
            fontBgColorPicker.value = rgbToHex(backColor || highlightColor) || '#FFFFFF';

            // For div background, check parent element's computed style
            const range = selection.getRangeAt(0);
            let targetElement = range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
            while (targetElement && !['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BODY'].includes(targetElement.tagName)) {
                targetElement = targetElement.parentNode;
            }
            if (targetElement && targetElement !== iframeDoc.body) {
                const computedStyle = previewFrame.contentWindow.getComputedStyle(targetElement);
                divBgColorPicker.value = rgbToHex(computedStyle.backgroundColor) || '#FFFFFF';
            } else {
                divBgColorPicker.value = '#FFFFFF';
            }

        } catch (e) {
            console.warn("Could not query command value for colors:", e);
        }

        try {
             const fontSize = iframeDoc.queryCommandValue('fontSize');
             fontSizeSelect.value = fontSize || '';
        } catch (e) {
            console.warn("Could not query command value for font size:", e);
            fontSizeSelect.value = '';
        }

        try {
            const fontFamily = iframeDoc.queryCommandValue('fontName');
            // execCommand('fontName') returns font name in quotes if it contains spaces.
            // Remove quotes and try to match with our list.
            const cleanFontFamily = fontFamily.replace(/["']/g, '').split(',')[0].trim(); // Take first font in stack
            if (googleFonts.includes(cleanFontFamily)) {
                fontFamilySelect.value = cleanFontFamily;
            } else {
                fontFamilySelect.value = ''; // Reset if not a recognized font
            }
        } catch (e) {
            console.warn("Could not query command value for font family:", e);
            fontFamilySelect.value = '';
        }
    }


    /**
     * Debounces a function call.
     * @param {Function} func - The function to debounce.
     * @param {number} delay - The debounce delay in milliseconds.
     */
    const debounce = (func, delay) => {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    };

    // Debounced version of syncFromPreview
    const syncFromPreviewDebounced = debounce(syncFromPreview, 500);


    // --- Core Functionality ---

    /**
     * Renders the HTML from the textarea into the iframe.
     * Also initializes the iframe's content for editing.
     */
    function updatePreview() {
        try {
            const htmlContent = htmlCodeTextArea.value;
            iframeDoc = previewFrame.contentWindow.document;

            // Prepare dynamic font imports for the iframe
            let fontImports = '';
            googleFonts.forEach(font => {
                // Replace spaces with '+' for Google Fonts URL and add a weight if needed (e.g., :wght@400)
                const fontUrl = font.replace(/ /g, '+');
                fontImports += `@import url('https://fonts.googleapis.com/css2?family=${fontUrl}&display=swap');\n`;
            });

            const iframeHTML = `
                <!DOCTYPE html>
                <html>
                <head>
                    ${fontImports}
                    <style>
                        body {
                            margin: 0;
                            padding: 1rem;
                            box-sizing: border-box;
                            font-family: 'Inter', sans-serif; /* Default base font */
                            line-height: 1.6;
                            word-wrap: break-word;
                            min-height: calc(100% - 2rem);
                            outline: none;
                        }
                        * {
                            box-sizing: border-box;
                        }
                        img {
                            max-width: 100%;
                            height: auto;
                            display: block;
                            margin: 0.5rem 0;
                            cursor: pointer;
                        }
                        a {
                            color: var(--primary-color, #4A90E2); /* Use CSS variable if defined in iframe, fallback to static */
                            text-decoration: underline;
                        }
                        ul, ol {
                            padding-left: 1.5rem;
                            margin-top: 0.5rem;
                            margin-bottom: 0.5rem;
                        }
                        p {
                            margin-bottom: 0.8rem;
                        }
                        p:last-child {
                            margin-bottom: 0;
                        }
                    </style>
                </head>
                <body>
                    ${htmlContent}
                </body>
                </html>
            `;

            iframeDoc.open();
            iframeDoc.write(iframeHTML);
            iframeDoc.close();

            // Set designMode to 'on' to make the content editable
            iframeDoc.designMode = 'on';

            // Add input event listener to the iframe body for continuous sync and toolbar updates
            iframeDoc.body.addEventListener('input', () => {
                syncFromPreviewDebounced();
                updateToolbarState();
            });

            // Listen for selection changes in the iframe to update toolbar state
            iframeDoc.addEventListener('selectionchange', updateToolbarState);

            showMessage('HTML rendered successfully! You can now edit the preview directly.', 3000);
        } catch (error) {
            console.error('Error rendering HTML:', error);
            showMessage('Error rendering HTML. Check console for details.', 5000);
        }
    }

    /**
     * Syncs the HTML content from the iframe's body back to the textarea.
     */
    function syncFromPreview() {
        if (!iframeDoc) {
            showMessage('No preview loaded to sync from.', 3000);
            return;
        }
        try {
            // contenteditable can sometimes add extra elements or attributes (e.g., <br> in empty lines)
            // For a truly production-ready app, you'd integrate a lightweight HTML sanitizer/cleaner here.
            // For now, we get the raw innerHTML.
            const liveHtmlContent = iframeDoc.body.innerHTML;
            htmlCodeTextArea.value = liveHtmlContent;
            showMessage('HTML synced from preview to source code.', 2000);
        } catch (error) {
            console.error('Error syncing HTML from preview:', error);
            showMessage('Error syncing HTML. Make sure the preview is loaded.', 5000);
        }
    }

    /**
     * Downloads the current HTML content from the textarea as an HTML file.
     */
    function downloadHtml() {
        try {
            const htmlContent = htmlCodeTextArea.value;
            const filename = 'my_editable_page.html';

            const blob = new Blob([htmlContent], { type: 'text/html' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);

            showMessage(`'${filename}' downloaded successfully!`, 3000);
        } catch (error) {
            console.error('Error downloading HTML:', error);
            showMessage('Error downloading HTML. Check console for details.', 5000);
        }
    }

    // --- Panel Resizing Logic ---
    let isResizing = false;

    splitter.addEventListener('mousedown', (e) => {
        // Only allow resizing on desktop (horizontal layout)
        if (window.innerWidth < 1024) return;

        isResizing = true;
        document.body.style.cursor = 'ew-resize'; // Change cursor globally
        document.body.style.userSelect = 'none'; // Prevent text selection during drag

        const startX = e.clientX;
        const leftPanelWidth = leftPanel.offsetWidth;
        const totalWidth = appContainer.offsetWidth;

        const onMouseMove = (moveEvent) => {
            if (!isResizing) return;

            const deltaX = moveEvent.clientX - startX;
            let newLeftPanelWidth = leftPanelWidth + deltaX;

            // Calculate percentage to ensure responsiveness
            let newLeftPanelPercentage = (newLeftPanelWidth / totalWidth) * 100;

            // Set min/max width percentages
            if (newLeftPanelPercentage < 20) newLeftPanelPercentage = 20; // Min 20%
            if (newLeftPanelPercentage > 80) newLeftPanelPercentage = 80; // Max 80%

            leftPanel.style.width = `${newLeftPanelPercentage}%`;
            rightPanel.style.width = `${100 - newLeftPanelPercentage}%`; // Right panel takes remaining
        };

        const onMouseUp = () => {
            isResizing = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = ''; // Reset cursor
            document.body.style.userSelect = ''; // Re-enable text selection
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });


    // --- Font Family Population ---
    function populateFontFamilySelect() {
        fontFamilySelect.innerHTML = '<option value="" disabled selected>Font Family</option>';
        googleFonts.forEach(font => {
            const option = document.createElement('option');
            option.value = font;
            option.textContent = font;
            // Apply font to option itself for preview
            option.style.fontFamily = `'${font}', sans-serif`;
            fontFamilySelect.appendChild(option);
        });
    }


    // --- Event Listeners ---

    // Panel action buttons
    renderButton.addEventListener('click', updatePreview);
    syncButton.addEventListener('click', syncFromPreview);
    downloadButton.addEventListener('click', downloadHtml);

    // Toolbar formatting buttons (using event delegation for simplicity and scalability)
    editorToolbar.addEventListener('click', (event) => {
        const target = event.target.closest('.toolbar-button');
        if (target) {
            const command = target.dataset.command;
            if (command) {
                executeCommand(command);
            }
        }
    });

    // Color pickers
    fontColorPicker.addEventListener('change', (event) => {
        executeCommand('foreColor', event.target.value);
    });

    fontBgColorPicker.addEventListener('change', (event) => {
        executeCommand('backColor', event.target.value);
    });

    divBgColorPicker.addEventListener('change', (event) => {
        if (iframeDoc && previewFrame.contentWindow.getSelection().rangeCount > 0) {
            const selection = previewFrame.contentWindow.getSelection();
            const range = selection.getRangeAt(0);
            let targetElement = range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
            while (targetElement && !['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI'].includes(targetElement.tagName) && targetElement !== iframeDoc.body) {
                targetElement = targetElement.parentNode;
            }

            if (targetElement && targetElement !== iframeDoc.body) {
                targetElement.style.backgroundColor = event.target.value;
                showMessage('Block background color applied.', 1500);
                syncFromPreviewDebounced();
            } else {
                showMessage('No suitable block element selected to apply background. Select a paragraph, heading, or div.', 3000);
            }
        }
    });

    // Font size select
    fontSizeSelect.addEventListener('change', (event) => {
        executeCommand('fontSize', event.target.value);
    });

    // Font family select
    fontFamilySelect.addEventListener('change', (event) => {
        const selectedFont = event.target.value;
        if (selectedFont) {
            // Apply the font to the selected text
            executeCommand('fontName', selectedFont);
            // Optionally, update the iframe's default body font if no text is selected
            if (iframeDoc && previewFrame.contentWindow.getSelection().rangeCount === 0 || previewFrame.contentWindow.getSelection().isCollapsed) {
                 iframeDoc.body.style.fontFamily = `'${selectedFont}', sans-serif`;
            }
        }
    });


    // Insert Link button
    insertLinkBtn.addEventListener('click', () => {
        openModal(linkModal);
        linkURLInput.focus();
    });

    confirmLinkBtn.addEventListener('click', () => {
        const url = linkURLInput.value;
        let text = linkTextInput.value;

        if (!url) {
            showMessage('Please enter a URL for the link.', 2000);
            return;
        }

        if (currentRange) {
            const selection = previewFrame.contentWindow.getSelection();
            selection.removeAllRanges();
            selection.addRange(currentRange);
        }

        // If no text was selected or provided, create a link with the URL as text
        if (!text && currentRange && currentRange.collapsed) {
             executeCommand('createLink', url);
             // After execCommand, find the newly created anchor and set its text if it was initially empty
             const newLink = iframeDoc.querySelector(`a[href="${url}"]`);
             if (newLink && newLink.textContent === url) { // Check if execCommand used URL as text
                 newLink.textContent = url; // Ensure it's correctly set if no text was pre-selected
             }
        } else if (!text && currentRange && !currentRange.collapsed) {
            // If text was selected, execCommand uses selected text. No need to modify.
            executeCommand('createLink', url);
        } else if (text) {
            // If text was provided in the modal, insert it as text then create link.
            if (currentRange) {
                currentRange.deleteContents(); // Remove selected text
                currentRange.insertNode(iframeDoc.createTextNode(text)); // Insert new text
                currentRange.selectNode(currentRange.startContainer.childNodes[currentRange.startOffset]); // Select newly inserted text
                const selection = previewFrame.contentWindow.getSelection();
                selection.removeAllRanges();
                selection.addRange(currentRange);
            } else {
                executeCommand('insertHTML', text); // Insert text at cursor
            }
            executeCommand('createLink', url); // Apply link to the inserted text
        }
        showMessage('Link inserted.', 1500);
        closeModal(linkModal);
    });

    // Insert Image button
    insertImageBtn.addEventListener('click', () => {
        openModal(imageModal);
        imageURLInput.focus();
    });

    confirmImageBtn.addEventListener('click', () => {
        const url = imageURLInput.value;
        if (!url) {
            showMessage('Please enter an image URL.', 2000);
            return;
        }

        if (currentRange) {
            const selection = previewFrame.contentWindow.getSelection();
            selection.removeAllRanges();
            selection.addRange(currentRange);
        }

        executeCommand('insertImage', url);
        showMessage('Image inserted.', 1500);
        closeModal(imageModal);
    });

    // Clear Formatting button
    clearFormatBtn.addEventListener('click', () => {
        executeCommand('removeFormat');
        showMessage('Formatting cleared.', 1500);
    });

    // Close buttons for modals
    closeButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            closeModal(event.target.closest('.modal'));
        });
    });

    // Close modals on outside click
    window.addEventListener('click', (event) => {
        if (event.target === linkModal) {
            closeModal(linkModal);
        }
        if (event.target === imageModal) {
            closeModal(imageModal);
        }
    });

    // --- Initial Setup ---
    populateFontFamilySelect(); // Populate font dropdown on load
    updatePreview(); // Initial render with default content and font imports
});
