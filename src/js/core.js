/*global Util, ButtonsData, Selection, Extension,
    extensionDefaults, Toolbar, Events, editorDefaults,
    DefaultButton, AnchorExtension, FontSizeExtension,
    AnchorPreviewDeprecated*/

function MediumEditor(elements, options) {
    'use strict';
    return this.init(elements, options);
}

(function () {
    'use strict';

    // Event handlers that shouldn't be exposed externally

    function handleDisabledEnterKeydown(event, element) {
        if (this.options.disableReturn || element.getAttribute('data-disable-return')) {
            event.preventDefault();
        } else if (this.options.disableDoubleReturn || element.getAttribute('data-disable-double-return')) {
            var node = Selection.getSelectionStart(this.options.ownerDocument);

            // if current text selection is empty OR previous sibling text is empty
            if ((node && node.textContent.trim() === '') ||
                (node.previousElementSibling && node.previousElementSibling.textContent.trim() === '')) {
                event.preventDefault();
            }
        }
    }

    function handleTabKeydown(event) {
        // Override tab only for pre nodes
        var node = Selection.getSelectionStart(this.options.ownerDocument),
            tag = node && node.tagName.toLowerCase();

        if (tag === 'pre') {
            event.preventDefault();
            Util.insertHTMLCommand(this.options.ownerDocument, '    ');
        }

        // Tab to indent list structures!
        if (Util.isListItem(node)) {
            event.preventDefault();

            // If Shift is down, outdent, otherwise indent
            if (event.shiftKey) {
                this.options.ownerDocument.execCommand('outdent', false, null);
            } else {
                this.options.ownerDocument.execCommand('indent', false, null);
            }
        }
    }

    function handleBlockDeleteKeydowns(event) {
        var p, node = Selection.getSelectionStart(this.options.ownerDocument),
            tagName = node.tagName.toLowerCase(),
            isEmpty = /^(\s+|<br\/?>)?$/i,
            isHeader = /h\d/i;

        if (Util.isKey(event, [Util.keyCode.BACKSPACE, Util.keyCode.ENTER]) &&
                // has a preceeding sibling
                node.previousElementSibling &&
                // in a header
                isHeader.test(tagName) &&
                // at the very end of the block
                Selection.getCaretOffsets(node).left === 0) {
            if (Util.isKey(event, Util.keyCode.BACKSPACE) && isEmpty.test(node.previousElementSibling.innerHTML)) {
                // backspacing the begining of a header into an empty previous element will
                // change the tagName of the current node to prevent one
                // instead delete previous node and cancel the event.
                node.previousElementSibling.parentNode.removeChild(node.previousElementSibling);
                event.preventDefault();
            } else if (Util.isKey(event, Util.keyCode.ENTER)) {
                // hitting return in the begining of a header will create empty header elements before the current one
                // instead, make "<p><br></p>" element, which are what happens if you hit return in an empty paragraph
                p = this.options.ownerDocument.createElement('p');
                p.innerHTML = '<br>';
                node.previousElementSibling.parentNode.insertBefore(p, node);
                event.preventDefault();
            }
        } else if (Util.isKey(event, Util.keyCode.DELETE) &&
                    // between two sibling elements
                    node.nextElementSibling &&
                    node.previousElementSibling &&
                    // not in a header
                    !isHeader.test(tagName) &&
                    // in an empty tag
                    isEmpty.test(node.innerHTML) &&
                    // when the next tag *is* a header
                    isHeader.test(node.nextElementSibling.tagName)) {
            // hitting delete in an empty element preceding a header, ex:
            //  <p>[CURSOR]</p><h1>Header</h1>
            // Will cause the h1 to become a paragraph.
            // Instead, delete the paragraph node and move the cursor to the begining of the h1

            // remove node and move cursor to start of header
            Selection.moveCursor(this.options.ownerDocument, node.nextElementSibling);

            node.previousElementSibling.parentNode.removeChild(node);

            event.preventDefault();
        } else if (Util.isKey(event, Util.keyCode.BACKSPACE) &&
                tagName === 'li' &&
                // hitting backspace inside an empty li
                isEmpty.test(node.innerHTML) &&
                // is first element (no preceeding siblings)
                !node.previousElementSibling &&
                // parent also does not have a sibling
                !node.parentElement.previousElementSibling &&
                // is not the only li in a list
                node.nextElementSibling &&
                node.nextElementSibling.tagName.toLowerCase() === 'li') {
            // backspacing in an empty first list element in the first list (with more elements) ex:
            //  <ul><li>[CURSOR]</li><li>List Item 2</li></ul>
            // will remove the first <li> but add some extra element before (varies based on browser)
            // Instead, this will:
            // 1) remove the list element
            // 2) create a paragraph before the list
            // 3) move the cursor into the paragraph

            // create a paragraph before the list
            p = this.options.ownerDocument.createElement('p');
            p.innerHTML = '<br>';
            node.parentElement.parentElement.insertBefore(p, node.parentElement);

            // move the cursor into the new paragraph
            Selection.moveCursor(this.options.ownerDocument, p);

            // remove the list element
            node.parentElement.removeChild(node);

            event.preventDefault();
        }
    }

    function handleKeyup(event) {
        var node = Selection.getSelectionStart(this.options.ownerDocument),
            tagName;

        if (!node) {
            return;
        }

        if (node.getAttribute('data-medium-element') && node.children.length === 0) {
            this.options.ownerDocument.execCommand('formatBlock', false, 'p');
        }

        if (Util.isKey(event, Util.keyCode.ENTER) && !Util.isListItem(node)) {
            tagName = node.tagName.toLowerCase();
            // For anchor tags, unlink
            if (tagName === 'a') {
                this.options.ownerDocument.execCommand('unlink', false, null);
            } else if (!event.shiftKey && !event.ctrlKey) {
                // only format block if this is not a header tag
                if (!/h\d/.test(tagName)) {
                    this.options.ownerDocument.execCommand('formatBlock', false, 'p');
                }
            }
        }
    }

    // Internal helper methods which shouldn't be exposed externally

    function addToEditors(win) {
        if (!win._mediumEditors) {
            // To avoid breaking users who are assuming that the unique id on
            // medium-editor elements will start at 1, inserting a 'null' in the
            // array so the unique-id can always map to the index of the editor instance
            win._mediumEditors = [null];
        }

        if (this.id) {
            // If this already has a unique id, re-use it
            win._mediumEditors[this.id] = this;
        } else {
            this.id = win._mediumEditors.length;
            win._mediumEditors.push(this);
        }
    }

    function removeFromEditors(win) {
        if (!win._mediumEditors || !win._mediumEditors[this.id]) {
            return;
        }

        /* Setting the instance to null in the array instead of deleting it allows:
         * 1) Each instance to preserve its own unique-id, even after being destroyed
         *    and initialized again
         * 2) The unique-id to always correspond to an index in the array of medium-editor
         *    instances. Thus, we will be able to look at a contenteditable, and determine
         *    which instance it belongs to, by indexing into the global array.
         */
        win._mediumEditors[this.id] = null;
    }

    function createElementsArray(selector) {
        if (!selector) {
            selector = [];
        }
        // If string, use as query selector
        if (typeof selector === 'string') {
            selector = this.options.ownerDocument.querySelectorAll(selector);
        }
        // If element, put into array
        if (Util.isElement(selector)) {
            selector = [selector];
        }
        // Convert NodeList (or other array like object) into an array
        var elements = Array.prototype.slice.apply(selector);

        // Loop through elements and convert textarea's into divs
        this.elements = [];
        elements.forEach(function (element) {
            if (element.tagName.toLowerCase() === 'textarea') {
                this.elements.push(createContentEditable.call(this, element));
            } else {
                this.elements.push(element);
            }
        }, this);
    }

    function setExtensionDefaults(extension, defaults) {
        Object.keys(defaults).forEach(function (prop) {
            if (extension[prop] === undefined) {
                extension[prop] = defaults[prop];
            }
        });
        return extension;
    }

    function initExtension(extension, name, instance) {
        if (typeof extension.parent !== 'undefined') {
            Util.warn('Extension .parent property has been deprecated.  ' +
                'The .base property for extensions will always be set to MediumEditor in version 5.0.0');
        }
        var extensionDefaults = {
            'window': instance.options.contentWindow,
            'document': instance.options.ownerDocument
        };
        // TODO: Deprecated (Remove .parent check in v5.0.0)
        if (extension.parent !== false) {
            extensionDefaults.base = instance;
        }
        // Add default options into the extension
        extension = setExtensionDefaults(extension, extensionDefaults);

        // Call init on the extension
        if (typeof extension.init === 'function') {
            // Passing instance into init() will be deprecated in v5.0.0
            extension.init(instance);
        }

        // Set extension name (if not already set)
        if (!extension.name) {
            extension.name = name;
        }
        return extension;
    }

    function isToolbarEnabled() {
        // TODO: deprecated
        // If toolbar is disabled, don't add it
        if (this.options.disableToolbar) {
            return false;
        }

        if (this.options.toolbar === false) {
            return false;
        }

        // If any of the elements don't have the toolbar disabled
        // We need a toolbar
        if(this.elements.every(function (element) {
                return !!element.getAttribute('data-disable-toolbar');
            })) {
            return false;
        }

        return true;
    }

    function shouldAddDefaultAnchorPreview() {
        // TODO: deprecated
        // If anchor-preview is disabled, don't add
        if (this.options.disableAnchorPreview) {
            return false;
        }
        // If anchor-preview is disabled, don't add
        if (this.options.anchorPreview === false) {
            return false;
        }
        // If anchor-preview extension has been overriden, don't add
        if (this.options.extensions['anchor-preview']) {
            return false;
        }
        // If toolbar is disabled, don't add
        if (!isToolbarEnabled.call(this)) {
            return false;
        }

        return true;
    }

    function shouldAddDefaultPlaceholder() {
        if (this.options.extensions['placeholder']) {
            return false;
        }

        // TODO: deprecated
        if (this.options.disablePlaceholders) {
            return false;
        }

        return this.options.placeholder !== false;
    }

    function shouldAddDefaultAutoLink() {
        if (this.options.extensions['auto-link']) {
            return false;
        }

        return this.options.autoLink !== false;
    }

    function shouldAddDefaultImageDragging() {
        if (this.options.extensions['image-dragging']) {
            return false;
        }

        return this.options.imageDragging !== false;
    }

    function createContentEditable(textarea) {
        var div = this.options.ownerDocument.createElement('div'),
            id = (+new Date()),
            attributesToClone = [
                'data-disable-editing',
                'data-disable-toolbar',
                'data-placeholder',
                'data-disable-return',
                'data-disable-double-return',
                'data-disable-preview',
                'spellcheck'
            ];

        div.className = textarea.className;
        div.id = id;
        div.innerHTML = textarea.value;
        div.setAttribute('medium-editor-textarea-id', id);
        attributesToClone.forEach(function (attr) {
            if (textarea.hasAttribute(attr)) {
                div.setAttribute(attr, textarea.getAttribute(attr));
            }
        });

        textarea.classList.add('medium-editor-hidden');
        textarea.setAttribute('medium-editor-textarea-id', id);
        textarea.parentNode.insertBefore(
            div,
            textarea
        );

        return div;
    }

    function initElements() {
        this.elements.forEach(function (element, index) {
            if (!this.options.disableEditing && !element.getAttribute('data-disable-editing')) {
                element.setAttribute('contentEditable', true);
                element.setAttribute('spellcheck', this.options.spellcheck);
            }
            element.setAttribute('data-medium-element', true);
            element.setAttribute('role', 'textbox');
            element.setAttribute('aria-multiline', true);
            element.setAttribute('medium-editor-index', index);

            if (element.hasAttribute('medium-editor-textarea-id')) {
                this.on(element, 'input', function (event) {
                    var target = event.target,
                        textarea = target.parentNode.querySelector('textarea[medium-editor-textarea-id="' + target.getAttribute('medium-editor-textarea-id') + '"]');
                    if (textarea) {
                        textarea.value = this.serialize()[target.id].value;
                    }
                }.bind(this));
            }
        }, this);
    }

    function attachHandlers() {
        var i;

        // attach to tabs
        this.subscribe('editableKeydownTab', handleTabKeydown.bind(this));

        // Bind keys which can create or destroy a block element: backspace, delete, return
        this.subscribe('editableKeydownDelete', handleBlockDeleteKeydowns.bind(this));
        this.subscribe('editableKeydownEnter', handleBlockDeleteKeydowns.bind(this));

        // disabling return or double return
        if (this.options.disableReturn || this.options.disableDoubleReturn) {
            this.subscribe('editableKeydownEnter', handleDisabledEnterKeydown.bind(this));
        } else {
            for (i = 0; i < this.elements.length; i += 1) {
                if (this.elements[i].getAttribute('data-disable-return') || this.elements[i].getAttribute('data-disable-double-return')) {
                    this.subscribe('editableKeydownEnter', handleDisabledEnterKeydown.bind(this));
                    break;
                }
            }
        }

        // if we're not disabling return, add a handler to help handle cleanup
        // for certain cases when enter is pressed
        if (!this.options.disableReturn) {
            this.elements.forEach(function (element) {
                if (!element.getAttribute('data-disable-return')) {
                    this.on(element, 'keyup', handleKeyup.bind(this));
                }
            }, this);
        }
    }

    function initToolbar(options) {
        if (this.options.extensions['toolbar']) {
            return this.options.extensions['toolbar'];
        }

        // Backwards compatability
        var defaultsBC = {
            align: this.options.toolbarAlign, // deprecated
            buttons: this.options.buttons, // deprecated
            diffLeft: this.options.diffLeft, // deprecated
            diffTop: this.options.diffTop, // deprecated
            firstButtonClass: this.options.firstButtonClass, // deprecated
            lastButtonClass: this.options.lastButtonClass, // deprecated
            static: this.options.staticToolbar, // deprecated
            sticky: this.options.stickyToolbar, // deprecated
            updateOnEmptySelection: this.options.updateOnEmptySelection // deprecated
        };

        return new MediumEditor.extensions.toolbar(
            Util.extend({}, options, defaultsBC)
        );
    }

    function initPlaceholder(options) {
        // Backwards compatability
        var defaultsBC = {
            text: (typeof this.options.placeholder === 'string') ? this.options.placeholder : undefined // deprecated
        };

        return new MediumEditor.extensions.placeholder(
            Util.extend({}, options, defaultsBC)
        );
    }

    function initAnchorPreview(options) {
        // Backwards compatability
        var defaultsBC = {
            hideDelay: this.options.anchorPreviewHideDelay, // deprecated
            diffLeft: this.options.diffLeft, // deprecated (should use .getEditorOption() instead)
            diffTop: this.options.diffTop, // deprecated (should use .getEditorOption() instead)
            elementsContainer: this.options.elementsContainer // deprecated (should use .getEditorOption() instead)
        };

        return new MediumEditor.extensions.anchorPreview(
            Util.extend({}, options, defaultsBC)
        );
    }

    function initAnchorForm(options) {
        // Backwards compatability
        var defaultsBC = {
            customClassOption: this.options.anchorButton ? (this.options.anchorButtonClass || 'btn') : undefined, // deprecated
            linkValidation: this.options.checkLinkFormat, //deprecated
            placeholderText: this.options.anchorInputPlaceholder, // deprecated
            targetCheckbox: this.options.anchorTarget, // deprecated
            targetCheckboxText: this.options.anchorInputCheckboxLabel // deprecated
        };

        return new MediumEditor.extensions.anchor(
            Util.extend({}, options, defaultsBC)
        );
    }

    function initPasteHandler(options) {
        // Backwards compatability
        var defaultsBC = {
            forcePlainText: this.options.forcePlainText, // deprecated
            cleanPastedHTML: this.options.cleanPastedHTML, // deprecated
            disableReturn: this.options.disableReturn, // deprecated (should use .getEditorOption() instead)
            targetBlank: this.options.targetBlank // deprecated (should use .getEditorOption() instead)
        };

        return new MediumEditor.extensions.paste(
            Util.extend({}, options, defaultsBC)
        );
    }

    function initCommands() {
        var buttons = MediumEditor.extensions.toolbar.prototype.buttons,
            extensions = this.options.extensions,
            ext,
            name;
        this.commands = [];

        if (this.options.toolbar && this.options.toolbar.buttons) {
            buttons = this.options.toolbar.buttons;
        } else if (this.options.buttons) {
            // TODO: Deprecate
            buttons = this.options.buttons;
        }

        buttons.forEach(function (buttonName) {
            if (extensions[buttonName]) {
                ext = initExtension(extensions[buttonName], buttonName, this);
                this.commands.push(ext);
            } else if (buttonName === 'anchor') {
                ext = initExtension(initAnchorForm.call(this, this.options.anchor), 'anchor', this);
                this.commands.push(ext);
            } else if (buttonName === 'fontsize') {
                ext = initExtension(new MediumEditor.extensions.fontSize(), buttonName, this);
                this.commands.push(ext);
            } else if (ButtonsData.hasOwnProperty(buttonName)) {
                ext = initExtension(new MediumEditor.extensions.button(ButtonsData[buttonName]), buttonName, this);
                this.commands.push(ext);
            }
        }, this);

        for (name in extensions) {
            if (name !== 'toolbar' &&
                extensions.hasOwnProperty(name) &&
                buttons.indexOf(name) === -1) {

                ext = initExtension(extensions[name], name, this);
                this.commands.push(ext);
            }
        }

        // Only add default paste extension if it wasn't overriden
        if (!this.options.extensions['paste']) {
            this.commands.push(initExtension(initPasteHandler.call(this, this.options.paste), 'paste', this));
        }

        // Add AnchorPreview as extension if needed
        if (shouldAddDefaultAnchorPreview.call(this)) {
            this.commands.push(initExtension(initAnchorPreview.call(this, this.options.anchorPreview), 'anchor-preview', this));
        }

        if (shouldAddDefaultAutoLink.call(this)) {
            this.commands.push(initExtension(new MediumEditor.extensions.autoLink(), 'auto-link', this));
        }

        if (shouldAddDefaultImageDragging.call(this)) {
            this.commands.push(initExtension(new MediumEditor.extensions.imageDragging(), 'image-dragging', this));
        }

        if (shouldAddDefaultPlaceholder.call(this)) {
            var placeholderOpts = (typeof this.options.placeholder === 'string') ? {} : this.options.placeholder;
            this.commands.push(initExtension(initPlaceholder.call(this, placeholderOpts), 'placeholder', this));
        }

        if (isToolbarEnabled.call(this)) {
            this.commands.push(initExtension(initToolbar.call(this, this.options.toolbar), 'toolbar', this));

            // TODO: Deprecate (this.toolbar is only around for backwards compatability)
            this.toolbar = this.getExtensionByName('toolbar');
        }
    }

    function mergeOptions(defaults, options) {
        var deprecatedProperties = [
            ['forcePlainText', 'paste.forcePlainText'],
            ['cleanPastedHTML', 'paste.cleanPastedHTML'],
            ['anchorInputPlaceholder', 'anchor.placeholderText'],
            ['checkLinkFormat', 'anchor.linkValidation'],
            ['anchorButton', 'anchor.customClassOption'],
            ['anchorButtonClass', 'anchor.customClassOption'],
            ['anchorTarget', 'anchor.targetCheckbox'],
            ['anchorInputCheckboxLabel', 'anchor.targetCheckboxText'],
            ['anchorPreviewHideDelay', 'anchorPreview.hideDelay'],
            ['disableAnchorPreview', 'anchorPreview: false'],
            ['disablePlaceholders', 'placeholder: false'],
            ['onShowToolbar', 'showToolbar custom event'],
            ['onHideToolbar', 'hideToolbar custom event'],
            ['toolbarAlign', 'toolbar.align'],
            ['buttons', 'toolbar.buttons'],
            ['diffLeft', 'toolbar.diffLeft'],
            ['diffTop', 'toolbar.diffTop'],
            ['firstButtonClass', 'toolbar.firstButtonClass'],
            ['lastButtonClass', 'toolbar.lastButtonClass'],
            ['staticToolbar', 'toolbar.static'],
            ['stickyToolbar', 'toolbar.sticky'],
            ['updateOnEmptySelection', 'toolbar.updateOnEmptySelection'],
            ['disableToolbar', 'toolbar: false']
        ];
        // warn about using deprecated properties
        if (options) {
            deprecatedProperties.forEach(function (pair) {
                if (options.hasOwnProperty(pair[0]) && options[pair[0]] !== undefined) {
                    Util.deprecated(pair[0], pair[1], 'v5.0.0');
                }
            });

            if (options.hasOwnProperty('placeholder') && typeof options.placeholder === 'string') {
                Util.deprecated('placeholder', 'placeholder.text', 'v5.0.0');
            }
        }

        return Util.defaults({}, options, defaults);
    }

    function execActionInternal(action, opts) {
        /*jslint regexp: true*/
        var appendAction = /^append-(.+)$/gi,
            match;
        /*jslint regexp: false*/

        // Actions starting with 'append-' should attempt to format a block of text ('formatBlock') using a specific
        // type of block element (ie append-blockquote, append-h1, append-pre, etc.)
        match = appendAction.exec(action);
        if (match) {
            return Util.execFormatBlock(this.options.ownerDocument, match[1]);
        }

        if (action === 'fontSize') {
            return this.options.ownerDocument.execCommand('fontSize', false, opts.size);
        }

        if (action === 'createLink') {
            return this.createLink(opts);
        }

        if (action === 'image') {
            return this.options.ownerDocument.execCommand('insertImage', false, this.options.contentWindow.getSelection());
        }

        return this.options.ownerDocument.execCommand(action, false, null);
    }

    // deprecate
    MediumEditor.statics = {
        ButtonsData: ButtonsData,
        DefaultButton: DefaultButton,
        AnchorExtension: AnchorExtension,
        FontSizeExtension: FontSizeExtension,
        Toolbar: Toolbar,
        AnchorPreview: AnchorPreviewDeprecated
    };

    MediumEditor.Extension = Extension;

    MediumEditor.extensions = extensionDefaults;
    MediumEditor.util = Util;
    MediumEditor.selection = Selection;

    MediumEditor.prototype = {
        defaults: editorDefaults,

        // NOT DOCUMENTED - exposed for backwards compatability
        init: function (elements, options) {
            this.options = mergeOptions.call(this, this.defaults, options);
            this.origElements = elements;

            if (!this.options.elementsContainer) {
                this.options.elementsContainer = this.options.ownerDocument.body;
            }

            return this.setup();
        },

        setup: function () {
            if (this.isActive) {
                return;
            }

            createElementsArray.call(this, this.origElements);

            if (this.elements.length === 0) {
                return;
            }

            this.isActive = true;
            addToEditors.call(this, this.options.contentWindow);

            this.events = new Events(this);

            // Call initialization helpers
            initElements.call(this);
            initCommands.call(this);
            attachHandlers.call(this);
        },

        destroy: function () {
            if (!this.isActive) {
                return;
            }

            this.isActive = false;

            this.commands.forEach(function (extension) {
                if (typeof extension.destroy === 'function') {
                    extension.destroy();
                } else if (typeof extension.deactivate === 'function') {
                    Util.warn('Extension .deactivate() function has been deprecated. Use .destroy() instead. This will be removed in version 5.0.0');
                    extension.deactivate();
                }
            }, this);

            // TODO: Deprecate (this.toolbar is only around for backwards compatability)
            if (this.toolbar) {
                delete this.toolbar;
            }

            this.elements.forEach(function (element) {
                // Reset elements content, fix for issue where after editor destroyed the red underlines on spelling errors are left
                if (this.options.spellcheck) {
                    element.innerHTML = element.innerHTML;
                }

                element.removeAttribute('contentEditable');
                element.removeAttribute('spellcheck');
                element.removeAttribute('data-medium-element');

                // Remove any elements created for textareas
                if (element.hasAttribute('medium-editor-textarea-id')) {
                    var textarea = element.parentNode.querySelector('textarea[medium-editor-textarea-id="' + element.getAttribute('medium-editor-textarea-id') + '"]');
                    if (textarea) {
                        // Un-hide the textarea
                        textarea.classList.remove('medium-editor-hidden');
                    }
                    if (element.parentNode) {
                        element.parentNode.removeChild(element);
                    }
                }
            }, this);
            this.elements = [];

            this.events.destroy();
            removeFromEditors.call(this, this.options.contentWindow);
        },

        on: function (target, event, listener, useCapture) {
            this.events.attachDOMEvent(target, event, listener, useCapture);
        },

        off: function (target, event, listener, useCapture) {
            this.events.detachDOMEvent(target, event, listener, useCapture);
        },

        subscribe: function (event, listener) {
            this.events.attachCustomEvent(event, listener);
        },

        unsubscribe: function (event, listener) {
            this.events.detachCustomEvent(event, listener);
        },

        createEvent: function () {
            Util.warn('.createEvent() has been deprecated and is no longer needed. ' +
                'You can attach and trigger custom events without calling this method.  This will be removed in v5.0.0');
        },

        trigger: function (name, data, editable) {
            this.events.triggerCustomEvent(name, data, editable);
        },

        delay: function (fn) {
            var self = this;
            return setTimeout(function () {
                if (self.isActive) {
                    fn();
                }
            }, this.options.delay);
        },

        serialize: function () {
            var i,
                elementid,
                content = {};
            for (i = 0; i < this.elements.length; i += 1) {
                elementid = (this.elements[i].id !== '') ? this.elements[i].id : 'element-' + i;
                content[elementid] = {
                    value: this.elements[i].innerHTML.trim()
                };
            }
            return content;
        },

        getExtensionByName: function (name) {
            var extension;
            if (this.commands && this.commands.length) {
                this.commands.some(function (ext) {
                    if (ext.name === name) {
                        extension = ext;
                        return true;
                    }
                    return false;
                });
            }
            return extension;
        },

        /**
         * NOT DOCUMENTED - exposed for backwards compatability
         * Helper function to call a method with a number of parameters on all registered extensions.
         * The function assures that the function exists before calling.
         *
         * @param {string} funcName name of the function to call
         * @param [args] arguments passed into funcName
         */
        callExtensions: function (funcName) {
            if (arguments.length < 1) {
                return;
            }

            var args = Array.prototype.slice.call(arguments, 1),
                ext,
                name;

            for (name in this.options.extensions) {
                if (this.options.extensions.hasOwnProperty(name)) {
                    ext = this.options.extensions[name];
                    if (ext[funcName] !== undefined) {
                        ext[funcName].apply(ext, args);
                    }
                }
            }
            return this;
        },

        stopSelectionUpdates: function () {
            this.preventSelectionUpdates = true;
        },

        startSelectionUpdates: function () {
            this.preventSelectionUpdates = false;
        },

        // NOT DOCUMENTED - exposed as extension helper and for backwards compatability
        checkSelection: function () {
            var toolbar = this.getExtensionByName('toolbar');
            if (toolbar) {
                toolbar.checkState();
            }
            return this;
        },

        // Wrapper around document.queryCommandState for checking whether an action has already
        // been applied to the current selection
        queryCommandState: function (action) {
            var fullAction = /^full-(.+)$/gi,
                match,
                queryState = null;

            // Actions starting with 'full-' need to be modified since this is a medium-editor concept
            match = fullAction.exec(action);
            if (match) {
                action = match[1];
            }

            try {
                queryState = this.options.ownerDocument.queryCommandState(action);
            } catch (exc) {
                queryState = null;
            }

            return queryState;
        },

        execAction: function (action, opts) {
            /*jslint regexp: true*/
            var fullAction = /^full-(.+)$/gi,
                match,
                result;
            /*jslint regexp: false*/

            // Actions starting with 'full-' should be applied to to the entire contents of the editable element
            // (ie full-bold, full-append-pre, etc.)
            match = fullAction.exec(action);
            if (match) {
                // Store the current selection to be restored after applying the action
                this.saveSelection();
                // Select all of the contents before calling the action
                this.selectAllContents();
                result = execActionInternal.call(this, match[1], opts);
                // Restore the previous selection
                this.restoreSelection();
            } else {
                result = execActionInternal.call(this, action, opts);
            }

            // do some DOM clean-up for known browser issues after the action
            if (action === 'insertunorderedlist' || action === 'insertorderedlist') {
                Util.cleanListDOM(this.options.ownerDocument, this.getSelectedParentElement());
            }

            this.checkSelection();
            return result;
        },

        getSelectedParentElement: function (range) {
            if (range === undefined) {
                range = this.options.contentWindow.getSelection().getRangeAt(0);
            }
            return Selection.getSelectedParentElement(range);
        },

        // NOT DOCUMENTED - exposed as extension helper
        // TODO: Deprecate
        hideToolbarDefaultActions: function () {
            Util.warn('hideToolbarDefaultActions() is deprecated.  ' +
                'use the hideToolbarDefaultActions() function of the toolbar extension instead.  This will be removed in v5.0.0');

            var toolbar = this.getExtensionByName('toolbar');
            if (toolbar) {
                toolbar.hideToolbarDefaultActions();
            }
            return this;
        },

        // NOT DOCUMENTED - exposed as extension helper and for backwards compatability
        setToolbarPosition: function () {
            Util.warn('setToolbarPosition() is deprecated.  ' +
                'use the setToolbarPosition() function of the toolbar extension instead.  This will be removed in v5.0.0');

            var toolbar = this.getExtensionByName('toolbar');
            if (toolbar) {
                toolbar.setToolbarPosition();
            }
        },

        selectAllContents: function () {
            var currNode = Selection.getSelectionElement(this.options.contentWindow);

            if (currNode) {
                // Move to the lowest descendant node that still selects all of the contents
                while (currNode.children.length === 1) {
                    currNode = currNode.children[0];
                }

                this.selectElement(currNode);
            }
        },

        selectElement: function (element) {
            Selection.selectNode(element, this.options.ownerDocument);

            var selElement = Selection.getSelectionElement(this.options.contentWindow);
            if (selElement) {
                this.events.focusElement(selElement);
            }
        },

        getFocusedElement: function () {
            var focused;
            this.elements.some(function (element) {
                // Find the element that has focus
                if (!focused && element.getAttribute('data-medium-focused')) {
                    focused = element;
                }

                // bail if we found the element that had focus
                return !!focused;
            }, this);

            return focused;
        },

        // http://stackoverflow.com/questions/17678843/cant-restore-selection-after-html-modify-even-if-its-the-same-html
        // Tim Down
        // TODO: move to selection.js and clean up old methods there
        exportSelection: function () {
            var selectionState = null,
                selection = this.options.contentWindow.getSelection(),
                range,
                preSelectionRange,
                start,
                editableElementIndex = -1;

            if (selection.rangeCount > 0) {
                range = selection.getRangeAt(0);
                preSelectionRange = range.cloneRange();

                // Find element current selection is inside
                this.elements.some(function (el, index) {
                    if (el === range.startContainer || Util.isDescendant(el, range.startContainer)) {
                        editableElementIndex = index;
                        return true;
                    }
                    return false;
                });

                if (editableElementIndex > -1) {
                    preSelectionRange.selectNodeContents(this.elements[editableElementIndex]);
                    preSelectionRange.setEnd(range.startContainer, range.startOffset);
                    start = preSelectionRange.toString().length;

                    selectionState = {
                        start: start,
                        end: start + range.toString().length,
                        editableElementIndex: editableElementIndex
                    };
                }
            }

            if (selectionState !== null && selectionState.editableElementIndex === 0) {
                delete selectionState.editableElementIndex;
            }

            return selectionState;
        },

        saveSelection: function () {
            this.selectionState = this.exportSelection();
        },

        // http://stackoverflow.com/questions/17678843/cant-restore-selection-after-html-modify-even-if-its-the-same-html
        // Tim Down
        // TODO: move to selection.js and clean up old methods there
        //
        // {object} inSelectionState - the selection to import
        // {boolean} [favorLaterSelectionAnchor] - defaults to false. If true, import the cursor immediately
        //      subsequent to an anchor tag if it would otherwise be placed right at the trailing edge inside the
        //      anchor. This cursor positioning, even though visually equivalent to the user, can affect behavior
        //      in MS IE.
        importSelection: function (inSelectionState, favorLaterSelectionAnchor) {
            if (!inSelectionState) {
                return;
            }

            var editableElementIndex = inSelectionState.editableElementIndex === undefined ?
                                                0 : inSelectionState.editableElementIndex,
                selectionState = {
                    editableElementIndex: editableElementIndex,
                    start: inSelectionState.start,
                    end: inSelectionState.end
                },
                editableElement = this.elements[selectionState.editableElementIndex],
                charIndex = 0,
                range = this.options.ownerDocument.createRange(),
                nodeStack = [editableElement],
                node,
                foundStart = false,
                stop = false,
                i,
                sel,
                nextCharIndex;

            range.setStart(editableElement, 0);
            range.collapse(true);

            node = nodeStack.pop();
            while (!stop && node) {
                if (node.nodeType === 3) {
                    nextCharIndex = charIndex + node.length;
                    if (!foundStart && selectionState.start >= charIndex && selectionState.start <= nextCharIndex) {
                        range.setStart(node, selectionState.start - charIndex);
                        foundStart = true;
                    }
                    if (foundStart && selectionState.end >= charIndex && selectionState.end <= nextCharIndex) {
                        range.setEnd(node, selectionState.end - charIndex);
                        stop = true;
                    }
                    charIndex = nextCharIndex;
                } else {
                    i = node.childNodes.length - 1;
                    while (i >= 0) {
                        nodeStack.push(node.childNodes[i]);
                        i -= 1;
                    }
                }
                if (!stop) {
                    node = nodeStack.pop();
                }
            }

            // If the selection is right at the ending edge of a link, put it outside the anchor tag instead of inside.
            if (favorLaterSelectionAnchor) {
                range = Selection.importSelectionMoveCursorPastAnchor(selectionState, range);
            }

            sel = this.options.contentWindow.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        },

        restoreSelection: function () {
            this.importSelection(this.selectionState);
        },

        createLink: function (opts) {
            var customEvent,
                i;

            if (opts.url && opts.url.trim().length > 0) {
                this.options.ownerDocument.execCommand('createLink', false, opts.url);

                if (this.options.targetBlank || opts.target === '_blank') {
                    Util.setTargetBlank(Selection.getSelectionStart(this.options.ownerDocument), opts.url);
                }

                if (opts.buttonClass) {
                    Util.addClassToAnchors(Selection.getSelectionStart(this.options.ownerDocument), opts.buttonClass);
                }
            }

            if (this.options.targetBlank || opts.target === '_blank' || opts.buttonClass) {
                customEvent = this.options.ownerDocument.createEvent('HTMLEvents');
                customEvent.initEvent('input', true, true, this.options.contentWindow);
                for (i = 0; i < this.elements.length; i += 1) {
                    this.elements[i].dispatchEvent(customEvent);
                }
            }
        },

        // alias for setup - keeping for backwards compatability
        activate: function () {
            Util.deprecatedMethod.call(this, 'activate', 'setup', arguments, 'v5.0.0');
        },

        // alias for destroy - keeping for backwards compatability
        deactivate: function () {
            Util.deprecatedMethod.call(this, 'deactivate', 'destroy', arguments, 'v5.0.0');
        },

        cleanPaste: function (text) {
            this.getExtensionByName('paste').cleanPaste(text);
        },

        pasteHTML: function (html, options) {
            this.getExtensionByName('paste').pasteHTML(html, options);
        }
    };
}());
