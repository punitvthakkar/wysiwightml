document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Element References ---
    const htmlCodeTextArea = document.getElementById('htmlCode');
    const previewFrame = document.getElementById('previewFrame');
    const renderButton = document.getElementById('renderButton');
    const syncButton = document.getElementById('syncButton');
    const downloadButton = document.getElementById('downloadButton');
    const messageBox = document.getElementById('messageBox');
    const editorToolbar = document.getElementById('editorToolbar');

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
    const divBgColorPicker = document.getElementById('divBgColorPicker'); // For block background
    const insertLinkBtn = document.getElementById('insertLinkBtn');
    const insertImageBtn = document.getElementById('insertImageBtn');
    const clearFormatBtn = document.getElementById('clearFormatBtn');
    const fontSizeSelect = document.getElementById('fontSizeSelect');

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
            showMessage(`${command} applied!`, 1500);
        } catch (error) {
            console.error(`Error executing command '${command}':`, error);
            showMessage(`Error applying ${command}.`, 3000);
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
        if (!iframeDoc) return;

        const selection = previewFrame.contentWindow.getSelection();
        if (!selection || selection.rangeCount === 0) {
            // No selection, deactivate all relevant buttons and reset values
            editorToolbar.querySelectorAll('.toolbar-button').forEach(btn => btn.classList.remove('active'));
            fontColorPicker.value = '#000000';
            fontBgColorPicker.value = '#FFFFFF';
            divBgColorPicker.value = '#FFFFFF';
            fontSizeSelect.value = ''; // Reset font size selection
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
                // Some commands might not support queryCommandState (e.g., foreColor)
                button.classList.remove('active');
            }
        });

        // Update color pickers based on current selection
        try {
            let foreColor = iframeDoc.queryCommandValue('foreColor');
            let backColor = iframeDoc.queryCommandValue('backColor');
            let highlightColor = iframeDoc.queryCommandValue('hiliteColor'); // for highlight

            // queryCommandValue returns RGB(A) or hex. Normalize to hex if possible.
            // Example: "rgb(0, 0, 0)" -> "#000000"
            const rgbToHex = (rgb) => {
                if (!rgb || rgb.includes('transparent')) return '#000000'; // Default black or white
                if (rgb.startsWith('#')) return rgb; // Already hex
                const parts = rgb.match(/\d+/g);
                if (!parts || parts.length < 3) return '#000000';
                return '#' + parts.slice(0, 3).map(x => {
                    const hex = parseInt(x).toString(16);
                    return hex.length === 1 ? '0' + hex : hex;
                }).join('');
            };

            fontColorPicker.value = rgbToHex(foreColor) || '#000000';
            fontBgColorPicker.value = rgbToHex(backColor || highlightColor) || '#FFFFFF'; // Prioritize backColor, then hiliteColor

            // For div background, check parent element. More complex, might require iterating parents.
            // For simplicity, we'll keep the input but its 'active' state is harder to determine with execCommand
            // Consider checking computed style of the closest block element parent.
        } catch (e) {
            console.warn("Could not query command value for colors:", e);
        }

        // Update font size select
        try {
             const fontSize = iframeDoc.queryCommandValue('fontSize');
             if (fontSize) {
                 // Convert pixel or point size to 1-7 scale for select. This is a rough estimation.
                 // Typical mappings: 1(8px), 2(10px), 3(12px), 4(14px), 5(18px), 6(24px), 7(36px)
                 // Or, if execCommand returns 1-7, use directly.
                 fontSizeSelect.value = fontSize;
             } else {
                 fontSizeSelect.value = '';
             }
        } catch (e) {
            console.warn("Could not query command value for font size:", e);
            fontSizeSelect.value = '';
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

            // Basic HTML structure for the iframe, including essential styles for predictable rendering
            // and an "Inter" font for consistency.
            const iframeHTML = `
                <!DOCTYPE html>
                <html>
                <head>
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
                    <style>
                        body {
                            margin: 0;
                            padding: 1rem;
                            box-sizing: border-box;
                            font-family: 'Inter', sans-serif;
                            line-height: 1.6;
                            word-wrap: break-word; /* Prevents long words from breaking layout */
                            min-height: calc(100% - 2rem); /* Ensure editable area has height */
                            outline: none; /* Remove default contenteditable outline */
                        }
                        * {
                            box-sizing: border-box;
                        }
                        img {
                            max-width: 100%;
                            height: auto;
                            display: block;
                            margin: 0.5rem 0; /* Add some space around images */
                            cursor: pointer; /* Indicate images are interactable */
                        }
                        a {
                            color: #4A90E2; /* Primary color for links */
                            text-decoration: underline;
                        }
                        /* Basic reset for lists */
                        ul, ol {
                            padding-left: 1.5rem;
                            margin-top: 0.5rem;
                            margin-bottom: 0.5rem;
                        }
                        /* Ensure paragraph spacing */
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
            // Use 'input' for contenteditable to catch text changes.
            iframeDoc.body.addEventListener('input', () => {
                syncFromPreviewDebounced();
                updateToolbarState(); // Update toolbar state on every input
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
        // Use 'backColor' for highlight or background color.
        executeCommand('backColor', event.target.value);
    });

    divBgColorPicker.addEventListener('change', (event) => {
        // This command applies a background color to the currently selected block element (e.g., <p>, <div>).
        // It's not standard execCommand for 'div background', but 'backColor' usually affects text background.
        // To apply background to a block, we'd need more complex DOM manipulation.
        // For simplicity, we'll try to apply it to the parent block element.
        if (iframeDoc && previewFrame.contentWindow.getSelection().rangeCount > 0) {
            const selection = previewFrame.contentWindow.getSelection();
            const range = selection.getRangeAt(0);
            const commonAncestor = range.commonAncestorContainer;

            // Find the closest block-level element
            let targetElement = commonAncestor.nodeType === 3 ? commonAncestor.parentNode : commonAncestor;
            while (targetElement && !['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI'].includes(targetElement.tagName)) {
                targetElement = targetElement.parentNode;
            }

            if (targetElement && targetElement !== iframeDoc.body) {
                targetElement.style.backgroundColor = event.target.value;
                showMessage('Block background color applied.', 1500);
                syncFromPreviewDebounced();
            } else {
                showMessage('No suitable block element selected to apply background.', 3000);
            }
        }
    });

    // Font size select
    fontSizeSelect.addEventListener('change', (event) => {
        executeCommand('fontSize', event.target.value);
    });

    // Insert Link button
    insertLinkBtn.addEventListener('click', () => {
        openModal(linkModal);
        linkURLInput.focus(); // Focus the URL input
    });

    confirmLinkBtn.addEventListener('click', () => {
        const url = linkURLInput.value;
        let text = linkTextInput.value;

        if (!url) {
            showMessage('Please enter a URL for the link.', 2000);
            return;
        }

        // If no text is provided, use the URL as text
        if (!text) {
            text = url;
        }

        // Restore selection if a range was stored
        if (currentRange) {
            const selection = previewFrame.contentWindow.getSelection();
            selection.removeAllRanges();
            selection.addRange(currentRange);
        }

        // Insert the link
        executeCommand('createLink', url);
        // After inserting link, if the text was not provided by user,
        // we might need to manually set the innerHTML of the created link
        // This is complex with execCommand, it usually creates an anchor with the URL as text if no text is selected.
        // A better approach would be to find the last created link and set its text.
        // For now, execCommand will handle it.
        showMessage('Link inserted.', 1500);
        closeModal(linkModal);
    });

    // Insert Image button
    insertImageBtn.addEventListener('click', () => {
        openModal(imageModal);
        imageURLInput.focus(); // Focus the URL input
    });

    confirmImageBtn.addEventListener('click', () => {
        const url = imageURLInput.value;
        if (!url) {
            showMessage('Please enter an image URL.', 2000);
            return;
        }

        // Restore selection if a range was stored
        if (currentRange) {
            const selection = previewFrame.contentWindow.getSelection();
            selection.removeAllRanges();
            selection.addRange(currentRange);
        }

        // Insert the image
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
    // Initial render when the page loads with the default content
    updatePreview();
});
