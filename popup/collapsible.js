/**
 * @file        collapsible.js
 * @description Provide accordion-style expand/collapse behavior for sections within the popup UI.
 *
 * @summary
 *  Functions:
 *    - initializeCollapsibles(): Attach toggle handlers to buttons with the `.collapsible` class.
 *    - setContentVisibility(content, button, open): Helper to show/hide content and sync the active class.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */
/**
 * Initializes collapsible sections within the popup.
 * Each `.collapsible` button toggles the visibility of the next sibling
 * `.collapsible-content` element, unless the button has been disabled by
 * other logic (cursor set to `not-allowed`).
 */
export function initializeCollapsibles() {
  const toggleButtons = document.querySelectorAll('.collapsible');

  toggleButtons.forEach(button => {
    const content = button.nextElementSibling;
    if (!content || !content.classList.contains('collapsible-content')) {
      return;
    }

    // Respect any default open state from markup
    const shouldStartOpen = button.classList.contains('active');
    setContentVisibility(content, button, shouldStartOpen);

    button.addEventListener('click', event => {
      // When disabled (used by logsTab.js), do nothing.
      if (button.style.cursor === 'not-allowed') {
        event.preventDefault();
        return;
      }

      const isOpen = content.style.display === 'block';
      setContentVisibility(content, button, !isOpen);
    });
  });
}

function setContentVisibility(content, button, open) {
  content.style.display = open ? 'block' : 'none';
  button.classList.toggle('active', open);
}

