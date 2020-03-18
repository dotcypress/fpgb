var wte = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function action_destroyer(action_result) {
        return action_result && is_function(action_result.destroy) ? action_result.destroy : noop;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function svg_element(name) {
        return document.createElementNS('http://www.w3.org/2000/svg', name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_input_value(input, value) {
        if (value != null || input.value) {
            input.value = value;
        }
    }
    function select_option(select, value) {
        for (let i = 0; i < select.options.length; i += 1) {
            const option = select.options[i];
            if (option.__value === value) {
                option.selected = true;
                return;
            }
        }
    }
    function select_value(select) {
        const selected_option = select.querySelector(':checked') || select.options[0];
        return selected_option && selected_option.__value;
    }
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error(`Function called outside component initialization`);
        return current_component;
    }
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }

    const globals = (typeof window !== 'undefined' ? window : global);
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if ($$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(children(options.target));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.19.2' }, detail)));
    }
    function append_dev(target, node) {
        dispatch_dev("SvelteDOMInsert", { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev("SvelteDOMInsert", { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev("SvelteDOMRemove", { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation) {
        const modifiers = options === true ? ["capture"] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        dispatch_dev("SvelteDOMAddEventListener", { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev("SvelteDOMRemoveEventListener", { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev("SvelteDOMRemoveAttribute", { node, attribute });
        else
            dispatch_dev("SvelteDOMSetAttribute", { node, attribute, value });
    }
    function prop_dev(node, property, value) {
        node[property] = value;
        dispatch_dev("SvelteDOMSetProperty", { node, property, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.data === data)
            return;
        dispatch_dev("SvelteDOMSetData", { node: text, data });
        text.data = data;
    }
    function validate_each_argument(arg) {
        if (typeof arg !== 'string' && !(arg && typeof arg === 'object' && 'length' in arg)) {
            let msg = '{#each} only iterates over array-like objects.';
            if (typeof Symbol === 'function' && arg && Symbol.iterator in arg) {
                msg += ' You can use a spread to convert this iterable into an array.';
            }
            throw new Error(msg);
        }
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error(`'target' is a required option`);
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn(`Component was already destroyed`); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    function styleInject(css, ref) {
      if ( ref === void 0 ) ref = {};
      var insertAt = ref.insertAt;

      if (!css || typeof document === 'undefined') { return; }

      var head = document.head || document.getElementsByTagName('head')[0];
      var style = document.createElement('style');
      style.type = 'text/css';

      if (insertAt === 'top') {
        if (head.firstChild) {
          head.insertBefore(style, head.firstChild);
        } else {
          head.appendChild(style);
        }
      } else {
        head.appendChild(style);
      }

      if (style.styleSheet) {
        style.styleSheet.cssText = css;
      } else {
        style.appendChild(document.createTextNode(css));
      }
    }

    var css = "/*! bulma.io v0.8.0 | MIT License | github.com/jgthms/bulma */@-webkit-keyframes spinAround{from{transform:rotate(0)}to{transform:rotate(359deg)}}@keyframes spinAround{from{transform:rotate(0)}to{transform:rotate(359deg)}}.breadcrumb,.button,.delete,.file,.is-unselectable,.modal-close,.pagination-ellipsis,.pagination-link,.pagination-next,.pagination-previous,.tabs{-webkit-touch-callout:none;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}.navbar-link:not(.is-arrowless)::after,.select:not(.is-multiple):not(.is-loading)::after{border:3px solid transparent;border-radius:2px;border-right:0;border-top:0;content:\" \";display:block;height:.625em;margin-top:-.4375em;pointer-events:none;position:absolute;top:50%;transform:rotate(-45deg);transform-origin:center;width:.625em}.block:not(:last-child),.box:not(:last-child),.breadcrumb:not(:last-child),.content:not(:last-child),.highlight:not(:last-child),.level:not(:last-child),.list:not(:last-child),.message:not(:last-child),.notification:not(:last-child),.pagination:not(:last-child),.progress:not(:last-child),.subtitle:not(:last-child),.table-container:not(:last-child),.table:not(:last-child),.tabs:not(:last-child),.title:not(:last-child){margin-bottom:1.5rem}.delete,.modal-close{-moz-appearance:none;-webkit-appearance:none;background-color:rgba(10,10,10,.2);border:none;border-radius:290486px;cursor:pointer;pointer-events:auto;display:inline-block;flex-grow:0;flex-shrink:0;font-size:0;height:20px;max-height:20px;max-width:20px;min-height:20px;min-width:20px;outline:0;position:relative;vertical-align:top;width:20px}.delete::after,.delete::before,.modal-close::after,.modal-close::before{background-color:#fff;content:\"\";display:block;left:50%;position:absolute;top:50%;transform:translateX(-50%) translateY(-50%) rotate(45deg);transform-origin:center center}.delete::before,.modal-close::before{height:2px;width:50%}.delete::after,.modal-close::after{height:50%;width:2px}.delete:focus,.delete:hover,.modal-close:focus,.modal-close:hover{background-color:rgba(10,10,10,.3)}.delete:active,.modal-close:active{background-color:rgba(10,10,10,.4)}.is-small.delete,.is-small.modal-close{height:16px;max-height:16px;max-width:16px;min-height:16px;min-width:16px;width:16px}.is-medium.delete,.is-medium.modal-close{height:24px;max-height:24px;max-width:24px;min-height:24px;min-width:24px;width:24px}.is-large.delete,.is-large.modal-close{height:32px;max-height:32px;max-width:32px;min-height:32px;min-width:32px;width:32px}.button.is-loading::after,.control.is-loading::after,.loader,.select.is-loading::after{-webkit-animation:spinAround .5s infinite linear;animation:spinAround .5s infinite linear;border:2px solid #dbdbdb;border-radius:290486px;border-right-color:transparent;border-top-color:transparent;content:\"\";display:block;height:1em;position:relative;width:1em}.hero-video,.image.is-16by9 .has-ratio,.image.is-16by9 img,.image.is-1by1 .has-ratio,.image.is-1by1 img,.image.is-1by2 .has-ratio,.image.is-1by2 img,.image.is-1by3 .has-ratio,.image.is-1by3 img,.image.is-2by1 .has-ratio,.image.is-2by1 img,.image.is-2by3 .has-ratio,.image.is-2by3 img,.image.is-3by1 .has-ratio,.image.is-3by1 img,.image.is-3by2 .has-ratio,.image.is-3by2 img,.image.is-3by4 .has-ratio,.image.is-3by4 img,.image.is-3by5 .has-ratio,.image.is-3by5 img,.image.is-4by3 .has-ratio,.image.is-4by3 img,.image.is-4by5 .has-ratio,.image.is-4by5 img,.image.is-5by3 .has-ratio,.image.is-5by3 img,.image.is-5by4 .has-ratio,.image.is-5by4 img,.image.is-9by16 .has-ratio,.image.is-9by16 img,.image.is-square .has-ratio,.image.is-square img,.is-overlay,.modal,.modal-background{bottom:0;left:0;position:absolute;right:0;top:0}.button,.file-cta,.file-name,.input,.pagination-ellipsis,.pagination-link,.pagination-next,.pagination-previous,.select select,.textarea{-moz-appearance:none;-webkit-appearance:none;align-items:center;border:1px solid transparent;border-radius:4px;box-shadow:none;display:inline-flex;font-size:1rem;height:2.5em;justify-content:flex-start;line-height:1.5;padding-bottom:calc(.5em - 1px);padding-left:calc(.75em - 1px);padding-right:calc(.75em - 1px);padding-top:calc(.5em - 1px);position:relative;vertical-align:top}.button:active,.button:focus,.file-cta:active,.file-cta:focus,.file-name:active,.file-name:focus,.input:active,.input:focus,.is-active.button,.is-active.file-cta,.is-active.file-name,.is-active.input,.is-active.pagination-ellipsis,.is-active.pagination-link,.is-active.pagination-next,.is-active.pagination-previous,.is-active.textarea,.is-focused.button,.is-focused.file-cta,.is-focused.file-name,.is-focused.input,.is-focused.pagination-ellipsis,.is-focused.pagination-link,.is-focused.pagination-next,.is-focused.pagination-previous,.is-focused.textarea,.pagination-ellipsis:active,.pagination-ellipsis:focus,.pagination-link:active,.pagination-link:focus,.pagination-next:active,.pagination-next:focus,.pagination-previous:active,.pagination-previous:focus,.select select.is-active,.select select.is-focused,.select select:active,.select select:focus,.textarea:active,.textarea:focus{outline:0}.button[disabled],.file-cta[disabled],.file-name[disabled],.input[disabled],.pagination-ellipsis[disabled],.pagination-link[disabled],.pagination-next[disabled],.pagination-previous[disabled],.select fieldset[disabled] select,.select select[disabled],.textarea[disabled],fieldset[disabled] .button,fieldset[disabled] .file-cta,fieldset[disabled] .file-name,fieldset[disabled] .input,fieldset[disabled] .pagination-ellipsis,fieldset[disabled] .pagination-link,fieldset[disabled] .pagination-next,fieldset[disabled] .pagination-previous,fieldset[disabled] .select select,fieldset[disabled] .textarea{cursor:not-allowed}/*! minireset.css v0.0.6 | MIT License | github.com/jgthms/minireset.css */blockquote,body,dd,dl,dt,fieldset,figure,h1,h2,h3,h4,h5,h6,hr,html,iframe,legend,li,ol,p,pre,textarea,ul{margin:0;padding:0}h1,h2,h3,h4,h5,h6{font-size:100%;font-weight:400}ul{list-style:none}button,input,select,textarea{margin:0}html{box-sizing:border-box}*,::after,::before{box-sizing:inherit}img,video{height:auto;max-width:100%}iframe{border:0}table{border-collapse:collapse;border-spacing:0}td,th{padding:0}td:not([align]),th:not([align]){text-align:left}html{background-color:#fff;font-size:16px;-moz-osx-font-smoothing:grayscale;-webkit-font-smoothing:antialiased;min-width:300px;overflow-x:hidden;overflow-y:scroll;text-rendering:optimizeLegibility;-webkit-text-size-adjust:100%;-moz-text-size-adjust:100%;-ms-text-size-adjust:100%;text-size-adjust:100%}article,aside,figure,footer,header,hgroup,section{display:block}body,button,input,select,textarea{font-family:BlinkMacSystemFont,-apple-system,\"Segoe UI\",Roboto,Oxygen,Ubuntu,Cantarell,\"Fira Sans\",\"Droid Sans\",\"Helvetica Neue\",Helvetica,Arial,sans-serif}code,pre{-moz-osx-font-smoothing:auto;-webkit-font-smoothing:auto;font-family:monospace}body{color:#4a4a4a;font-size:1em;font-weight:400;line-height:1.5}a{color:#3273dc;cursor:pointer;text-decoration:none}a strong{color:currentColor}a:hover{color:#363636}code{background-color:#f5f5f5;color:#f14668;font-size:.875em;font-weight:400;padding:.25em .5em .25em}hr{background-color:#f5f5f5;border:none;display:block;height:2px;margin:1.5rem 0}img{height:auto;max-width:100%}input[type=checkbox],input[type=radio]{vertical-align:baseline}small{font-size:.875em}span{font-style:inherit;font-weight:inherit}strong{color:#363636;font-weight:700}fieldset{border:none}pre{-webkit-overflow-scrolling:touch;background-color:#f5f5f5;color:#4a4a4a;font-size:.875em;overflow-x:auto;padding:1.25rem 1.5rem;white-space:pre;word-wrap:normal}pre code{background-color:transparent;color:currentColor;font-size:1em;padding:0}table td,table th{vertical-align:top}table td:not([align]),table th:not([align]){text-align:left}table th{color:#363636}.is-clearfix::after{clear:both;content:\" \";display:table}.is-pulled-left{float:left!important}.is-pulled-right{float:right!important}.is-clipped{overflow:hidden!important}.is-size-1{font-size:3rem!important}.is-size-2{font-size:2.5rem!important}.is-size-3{font-size:2rem!important}.is-size-4{font-size:1.5rem!important}.is-size-5{font-size:1.25rem!important}.is-size-6{font-size:1rem!important}.is-size-7{font-size:.75rem!important}@media screen and (max-width:768px){.is-size-1-mobile{font-size:3rem!important}.is-size-2-mobile{font-size:2.5rem!important}.is-size-3-mobile{font-size:2rem!important}.is-size-4-mobile{font-size:1.5rem!important}.is-size-5-mobile{font-size:1.25rem!important}.is-size-6-mobile{font-size:1rem!important}.is-size-7-mobile{font-size:.75rem!important}}@media screen and (min-width:769px),print{.is-size-1-tablet{font-size:3rem!important}.is-size-2-tablet{font-size:2.5rem!important}.is-size-3-tablet{font-size:2rem!important}.is-size-4-tablet{font-size:1.5rem!important}.is-size-5-tablet{font-size:1.25rem!important}.is-size-6-tablet{font-size:1rem!important}.is-size-7-tablet{font-size:.75rem!important}}@media screen and (max-width:1023px){.is-size-1-touch{font-size:3rem!important}.is-size-2-touch{font-size:2.5rem!important}.is-size-3-touch{font-size:2rem!important}.is-size-4-touch{font-size:1.5rem!important}.is-size-5-touch{font-size:1.25rem!important}.is-size-6-touch{font-size:1rem!important}.is-size-7-touch{font-size:.75rem!important}}@media screen and (min-width:1024px){.is-size-1-desktop{font-size:3rem!important}.is-size-2-desktop{font-size:2.5rem!important}.is-size-3-desktop{font-size:2rem!important}.is-size-4-desktop{font-size:1.5rem!important}.is-size-5-desktop{font-size:1.25rem!important}.is-size-6-desktop{font-size:1rem!important}.is-size-7-desktop{font-size:.75rem!important}}@media screen and (min-width:1216px){.is-size-1-widescreen{font-size:3rem!important}.is-size-2-widescreen{font-size:2.5rem!important}.is-size-3-widescreen{font-size:2rem!important}.is-size-4-widescreen{font-size:1.5rem!important}.is-size-5-widescreen{font-size:1.25rem!important}.is-size-6-widescreen{font-size:1rem!important}.is-size-7-widescreen{font-size:.75rem!important}}@media screen and (min-width:1408px){.is-size-1-fullhd{font-size:3rem!important}.is-size-2-fullhd{font-size:2.5rem!important}.is-size-3-fullhd{font-size:2rem!important}.is-size-4-fullhd{font-size:1.5rem!important}.is-size-5-fullhd{font-size:1.25rem!important}.is-size-6-fullhd{font-size:1rem!important}.is-size-7-fullhd{font-size:.75rem!important}}.has-text-centered{text-align:center!important}.has-text-justified{text-align:justify!important}.has-text-left{text-align:left!important}.has-text-right{text-align:right!important}@media screen and (max-width:768px){.has-text-centered-mobile{text-align:center!important}}@media screen and (min-width:769px),print{.has-text-centered-tablet{text-align:center!important}}@media screen and (min-width:769px) and (max-width:1023px){.has-text-centered-tablet-only{text-align:center!important}}@media screen and (max-width:1023px){.has-text-centered-touch{text-align:center!important}}@media screen and (min-width:1024px){.has-text-centered-desktop{text-align:center!important}}@media screen and (min-width:1024px) and (max-width:1215px){.has-text-centered-desktop-only{text-align:center!important}}@media screen and (min-width:1216px){.has-text-centered-widescreen{text-align:center!important}}@media screen and (min-width:1216px) and (max-width:1407px){.has-text-centered-widescreen-only{text-align:center!important}}@media screen and (min-width:1408px){.has-text-centered-fullhd{text-align:center!important}}@media screen and (max-width:768px){.has-text-justified-mobile{text-align:justify!important}}@media screen and (min-width:769px),print{.has-text-justified-tablet{text-align:justify!important}}@media screen and (min-width:769px) and (max-width:1023px){.has-text-justified-tablet-only{text-align:justify!important}}@media screen and (max-width:1023px){.has-text-justified-touch{text-align:justify!important}}@media screen and (min-width:1024px){.has-text-justified-desktop{text-align:justify!important}}@media screen and (min-width:1024px) and (max-width:1215px){.has-text-justified-desktop-only{text-align:justify!important}}@media screen and (min-width:1216px){.has-text-justified-widescreen{text-align:justify!important}}@media screen and (min-width:1216px) and (max-width:1407px){.has-text-justified-widescreen-only{text-align:justify!important}}@media screen and (min-width:1408px){.has-text-justified-fullhd{text-align:justify!important}}@media screen and (max-width:768px){.has-text-left-mobile{text-align:left!important}}@media screen and (min-width:769px),print{.has-text-left-tablet{text-align:left!important}}@media screen and (min-width:769px) and (max-width:1023px){.has-text-left-tablet-only{text-align:left!important}}@media screen and (max-width:1023px){.has-text-left-touch{text-align:left!important}}@media screen and (min-width:1024px){.has-text-left-desktop{text-align:left!important}}@media screen and (min-width:1024px) and (max-width:1215px){.has-text-left-desktop-only{text-align:left!important}}@media screen and (min-width:1216px){.has-text-left-widescreen{text-align:left!important}}@media screen and (min-width:1216px) and (max-width:1407px){.has-text-left-widescreen-only{text-align:left!important}}@media screen and (min-width:1408px){.has-text-left-fullhd{text-align:left!important}}@media screen and (max-width:768px){.has-text-right-mobile{text-align:right!important}}@media screen and (min-width:769px),print{.has-text-right-tablet{text-align:right!important}}@media screen and (min-width:769px) and (max-width:1023px){.has-text-right-tablet-only{text-align:right!important}}@media screen and (max-width:1023px){.has-text-right-touch{text-align:right!important}}@media screen and (min-width:1024px){.has-text-right-desktop{text-align:right!important}}@media screen and (min-width:1024px) and (max-width:1215px){.has-text-right-desktop-only{text-align:right!important}}@media screen and (min-width:1216px){.has-text-right-widescreen{text-align:right!important}}@media screen and (min-width:1216px) and (max-width:1407px){.has-text-right-widescreen-only{text-align:right!important}}@media screen and (min-width:1408px){.has-text-right-fullhd{text-align:right!important}}.is-capitalized{text-transform:capitalize!important}.is-lowercase{text-transform:lowercase!important}.is-uppercase{text-transform:uppercase!important}.is-italic{font-style:italic!important}.has-text-white{color:#fff!important}a.has-text-white:focus,a.has-text-white:hover{color:#e6e6e6!important}.has-background-white{background-color:#fff!important}.has-text-black{color:#0a0a0a!important}a.has-text-black:focus,a.has-text-black:hover{color:#000!important}.has-background-black{background-color:#0a0a0a!important}.has-text-light{color:#f5f5f5!important}a.has-text-light:focus,a.has-text-light:hover{color:#dbdbdb!important}.has-background-light{background-color:#f5f5f5!important}.has-text-dark{color:#363636!important}a.has-text-dark:focus,a.has-text-dark:hover{color:#1c1c1c!important}.has-background-dark{background-color:#363636!important}.has-text-primary{color:#00d1b2!important}a.has-text-primary:focus,a.has-text-primary:hover{color:#009e86!important}.has-background-primary{background-color:#00d1b2!important}.has-text-link{color:#3273dc!important}a.has-text-link:focus,a.has-text-link:hover{color:#205bbc!important}.has-background-link{background-color:#3273dc!important}.has-text-info{color:#3298dc!important}a.has-text-info:focus,a.has-text-info:hover{color:#207dbc!important}.has-background-info{background-color:#3298dc!important}.has-text-success{color:#48c774!important}a.has-text-success:focus,a.has-text-success:hover{color:#34a85c!important}.has-background-success{background-color:#48c774!important}.has-text-warning{color:#ffdd57!important}a.has-text-warning:focus,a.has-text-warning:hover{color:#ffd324!important}.has-background-warning{background-color:#ffdd57!important}.has-text-danger{color:#f14668!important}a.has-text-danger:focus,a.has-text-danger:hover{color:#ee1742!important}.has-background-danger{background-color:#f14668!important}.has-text-black-bis{color:#121212!important}.has-background-black-bis{background-color:#121212!important}.has-text-black-ter{color:#242424!important}.has-background-black-ter{background-color:#242424!important}.has-text-grey-darker{color:#363636!important}.has-background-grey-darker{background-color:#363636!important}.has-text-grey-dark{color:#4a4a4a!important}.has-background-grey-dark{background-color:#4a4a4a!important}.has-text-grey{color:#7a7a7a!important}.has-background-grey{background-color:#7a7a7a!important}.has-text-grey-light{color:#b5b5b5!important}.has-background-grey-light{background-color:#b5b5b5!important}.has-text-grey-lighter{color:#dbdbdb!important}.has-background-grey-lighter{background-color:#dbdbdb!important}.has-text-white-ter{color:#f5f5f5!important}.has-background-white-ter{background-color:#f5f5f5!important}.has-text-white-bis{color:#fafafa!important}.has-background-white-bis{background-color:#fafafa!important}.has-text-weight-light{font-weight:300!important}.has-text-weight-normal{font-weight:400!important}.has-text-weight-medium{font-weight:500!important}.has-text-weight-semibold{font-weight:600!important}.has-text-weight-bold{font-weight:700!important}.is-family-primary{font-family:BlinkMacSystemFont,-apple-system,\"Segoe UI\",Roboto,Oxygen,Ubuntu,Cantarell,\"Fira Sans\",\"Droid Sans\",\"Helvetica Neue\",Helvetica,Arial,sans-serif!important}.is-family-secondary{font-family:BlinkMacSystemFont,-apple-system,\"Segoe UI\",Roboto,Oxygen,Ubuntu,Cantarell,\"Fira Sans\",\"Droid Sans\",\"Helvetica Neue\",Helvetica,Arial,sans-serif!important}.is-family-sans-serif{font-family:BlinkMacSystemFont,-apple-system,\"Segoe UI\",Roboto,Oxygen,Ubuntu,Cantarell,\"Fira Sans\",\"Droid Sans\",\"Helvetica Neue\",Helvetica,Arial,sans-serif!important}.is-family-monospace{font-family:monospace!important}.is-family-code{font-family:monospace!important}.is-block{display:block!important}@media screen and (max-width:768px){.is-block-mobile{display:block!important}}@media screen and (min-width:769px),print{.is-block-tablet{display:block!important}}@media screen and (min-width:769px) and (max-width:1023px){.is-block-tablet-only{display:block!important}}@media screen and (max-width:1023px){.is-block-touch{display:block!important}}@media screen and (min-width:1024px){.is-block-desktop{display:block!important}}@media screen and (min-width:1024px) and (max-width:1215px){.is-block-desktop-only{display:block!important}}@media screen and (min-width:1216px){.is-block-widescreen{display:block!important}}@media screen and (min-width:1216px) and (max-width:1407px){.is-block-widescreen-only{display:block!important}}@media screen and (min-width:1408px){.is-block-fullhd{display:block!important}}.is-flex{display:flex!important}@media screen and (max-width:768px){.is-flex-mobile{display:flex!important}}@media screen and (min-width:769px),print{.is-flex-tablet{display:flex!important}}@media screen and (min-width:769px) and (max-width:1023px){.is-flex-tablet-only{display:flex!important}}@media screen and (max-width:1023px){.is-flex-touch{display:flex!important}}@media screen and (min-width:1024px){.is-flex-desktop{display:flex!important}}@media screen and (min-width:1024px) and (max-width:1215px){.is-flex-desktop-only{display:flex!important}}@media screen and (min-width:1216px){.is-flex-widescreen{display:flex!important}}@media screen and (min-width:1216px) and (max-width:1407px){.is-flex-widescreen-only{display:flex!important}}@media screen and (min-width:1408px){.is-flex-fullhd{display:flex!important}}.is-inline{display:inline!important}@media screen and (max-width:768px){.is-inline-mobile{display:inline!important}}@media screen and (min-width:769px),print{.is-inline-tablet{display:inline!important}}@media screen and (min-width:769px) and (max-width:1023px){.is-inline-tablet-only{display:inline!important}}@media screen and (max-width:1023px){.is-inline-touch{display:inline!important}}@media screen and (min-width:1024px){.is-inline-desktop{display:inline!important}}@media screen and (min-width:1024px) and (max-width:1215px){.is-inline-desktop-only{display:inline!important}}@media screen and (min-width:1216px){.is-inline-widescreen{display:inline!important}}@media screen and (min-width:1216px) and (max-width:1407px){.is-inline-widescreen-only{display:inline!important}}@media screen and (min-width:1408px){.is-inline-fullhd{display:inline!important}}.is-inline-block{display:inline-block!important}@media screen and (max-width:768px){.is-inline-block-mobile{display:inline-block!important}}@media screen and (min-width:769px),print{.is-inline-block-tablet{display:inline-block!important}}@media screen and (min-width:769px) and (max-width:1023px){.is-inline-block-tablet-only{display:inline-block!important}}@media screen and (max-width:1023px){.is-inline-block-touch{display:inline-block!important}}@media screen and (min-width:1024px){.is-inline-block-desktop{display:inline-block!important}}@media screen and (min-width:1024px) and (max-width:1215px){.is-inline-block-desktop-only{display:inline-block!important}}@media screen and (min-width:1216px){.is-inline-block-widescreen{display:inline-block!important}}@media screen and (min-width:1216px) and (max-width:1407px){.is-inline-block-widescreen-only{display:inline-block!important}}@media screen and (min-width:1408px){.is-inline-block-fullhd{display:inline-block!important}}.is-inline-flex{display:inline-flex!important}@media screen and (max-width:768px){.is-inline-flex-mobile{display:inline-flex!important}}@media screen and (min-width:769px),print{.is-inline-flex-tablet{display:inline-flex!important}}@media screen and (min-width:769px) and (max-width:1023px){.is-inline-flex-tablet-only{display:inline-flex!important}}@media screen and (max-width:1023px){.is-inline-flex-touch{display:inline-flex!important}}@media screen and (min-width:1024px){.is-inline-flex-desktop{display:inline-flex!important}}@media screen and (min-width:1024px) and (max-width:1215px){.is-inline-flex-desktop-only{display:inline-flex!important}}@media screen and (min-width:1216px){.is-inline-flex-widescreen{display:inline-flex!important}}@media screen and (min-width:1216px) and (max-width:1407px){.is-inline-flex-widescreen-only{display:inline-flex!important}}@media screen and (min-width:1408px){.is-inline-flex-fullhd{display:inline-flex!important}}.is-hidden{display:none!important}.is-sr-only{border:none!important;clip:rect(0,0,0,0)!important;height:.01em!important;overflow:hidden!important;padding:0!important;position:absolute!important;white-space:nowrap!important;width:.01em!important}@media screen and (max-width:768px){.is-hidden-mobile{display:none!important}}@media screen and (min-width:769px),print{.is-hidden-tablet{display:none!important}}@media screen and (min-width:769px) and (max-width:1023px){.is-hidden-tablet-only{display:none!important}}@media screen and (max-width:1023px){.is-hidden-touch{display:none!important}}@media screen and (min-width:1024px){.is-hidden-desktop{display:none!important}}@media screen and (min-width:1024px) and (max-width:1215px){.is-hidden-desktop-only{display:none!important}}@media screen and (min-width:1216px){.is-hidden-widescreen{display:none!important}}@media screen and (min-width:1216px) and (max-width:1407px){.is-hidden-widescreen-only{display:none!important}}@media screen and (min-width:1408px){.is-hidden-fullhd{display:none!important}}.is-invisible{visibility:hidden!important}@media screen and (max-width:768px){.is-invisible-mobile{visibility:hidden!important}}@media screen and (min-width:769px),print{.is-invisible-tablet{visibility:hidden!important}}@media screen and (min-width:769px) and (max-width:1023px){.is-invisible-tablet-only{visibility:hidden!important}}@media screen and (max-width:1023px){.is-invisible-touch{visibility:hidden!important}}@media screen and (min-width:1024px){.is-invisible-desktop{visibility:hidden!important}}@media screen and (min-width:1024px) and (max-width:1215px){.is-invisible-desktop-only{visibility:hidden!important}}@media screen and (min-width:1216px){.is-invisible-widescreen{visibility:hidden!important}}@media screen and (min-width:1216px) and (max-width:1407px){.is-invisible-widescreen-only{visibility:hidden!important}}@media screen and (min-width:1408px){.is-invisible-fullhd{visibility:hidden!important}}.is-marginless{margin:0!important}.is-paddingless{padding:0!important}.is-radiusless{border-radius:0!important}.is-shadowless{box-shadow:none!important}.is-relative{position:relative!important}.box{background-color:#fff;border-radius:6px;box-shadow:0 .5em 1em -.125em rgba(10,10,10,.1),0 0 0 1px rgba(10,10,10,.02);color:#4a4a4a;display:block;padding:1.25rem}a.box:focus,a.box:hover{box-shadow:0 .5em 1em -.125em rgba(10,10,10,.1),0 0 0 1px #3273dc}a.box:active{box-shadow:inset 0 1px 2px rgba(10,10,10,.2),0 0 0 1px #3273dc}.button{background-color:#fff;border-color:#dbdbdb;border-width:1px;color:#363636;cursor:pointer;justify-content:center;padding-bottom:calc(.5em - 1px);padding-left:1em;padding-right:1em;padding-top:calc(.5em - 1px);text-align:center;white-space:nowrap}.button strong{color:inherit}.button .icon,.button .icon.is-large,.button .icon.is-medium,.button .icon.is-small{height:1.5em;width:1.5em}.button .icon:first-child:not(:last-child){margin-left:calc(-.5em - 1px);margin-right:.25em}.button .icon:last-child:not(:first-child){margin-left:.25em;margin-right:calc(-.5em - 1px)}.button .icon:first-child:last-child{margin-left:calc(-.5em - 1px);margin-right:calc(-.5em - 1px)}.button.is-hovered,.button:hover{border-color:#b5b5b5;color:#363636}.button.is-focused,.button:focus{border-color:#3273dc;color:#363636}.button.is-focused:not(:active),.button:focus:not(:active){box-shadow:0 0 0 .125em rgba(50,115,220,.25)}.button.is-active,.button:active{border-color:#4a4a4a;color:#363636}.button.is-text{background-color:transparent;border-color:transparent;color:#4a4a4a;text-decoration:underline}.button.is-text.is-focused,.button.is-text.is-hovered,.button.is-text:focus,.button.is-text:hover{background-color:#f5f5f5;color:#363636}.button.is-text.is-active,.button.is-text:active{background-color:#e8e8e8;color:#363636}.button.is-text[disabled],fieldset[disabled] .button.is-text{background-color:transparent;border-color:transparent;box-shadow:none}.button.is-white{background-color:#fff;border-color:transparent;color:#0a0a0a}.button.is-white.is-hovered,.button.is-white:hover{background-color:#f9f9f9;border-color:transparent;color:#0a0a0a}.button.is-white.is-focused,.button.is-white:focus{border-color:transparent;color:#0a0a0a}.button.is-white.is-focused:not(:active),.button.is-white:focus:not(:active){box-shadow:0 0 0 .125em rgba(255,255,255,.25)}.button.is-white.is-active,.button.is-white:active{background-color:#f2f2f2;border-color:transparent;color:#0a0a0a}.button.is-white[disabled],fieldset[disabled] .button.is-white{background-color:#fff;border-color:transparent;box-shadow:none}.button.is-white.is-inverted{background-color:#0a0a0a;color:#fff}.button.is-white.is-inverted.is-hovered,.button.is-white.is-inverted:hover{background-color:#000}.button.is-white.is-inverted[disabled],fieldset[disabled] .button.is-white.is-inverted{background-color:#0a0a0a;border-color:transparent;box-shadow:none;color:#fff}.button.is-white.is-loading::after{border-color:transparent transparent #0a0a0a #0a0a0a!important}.button.is-white.is-outlined{background-color:transparent;border-color:#fff;color:#fff}.button.is-white.is-outlined.is-focused,.button.is-white.is-outlined.is-hovered,.button.is-white.is-outlined:focus,.button.is-white.is-outlined:hover{background-color:#fff;border-color:#fff;color:#0a0a0a}.button.is-white.is-outlined.is-loading::after{border-color:transparent transparent #fff #fff!important}.button.is-white.is-outlined.is-loading.is-focused::after,.button.is-white.is-outlined.is-loading.is-hovered::after,.button.is-white.is-outlined.is-loading:focus::after,.button.is-white.is-outlined.is-loading:hover::after{border-color:transparent transparent #0a0a0a #0a0a0a!important}.button.is-white.is-outlined[disabled],fieldset[disabled] .button.is-white.is-outlined{background-color:transparent;border-color:#fff;box-shadow:none;color:#fff}.button.is-white.is-inverted.is-outlined{background-color:transparent;border-color:#0a0a0a;color:#0a0a0a}.button.is-white.is-inverted.is-outlined.is-focused,.button.is-white.is-inverted.is-outlined.is-hovered,.button.is-white.is-inverted.is-outlined:focus,.button.is-white.is-inverted.is-outlined:hover{background-color:#0a0a0a;color:#fff}.button.is-white.is-inverted.is-outlined.is-loading.is-focused::after,.button.is-white.is-inverted.is-outlined.is-loading.is-hovered::after,.button.is-white.is-inverted.is-outlined.is-loading:focus::after,.button.is-white.is-inverted.is-outlined.is-loading:hover::after{border-color:transparent transparent #fff #fff!important}.button.is-white.is-inverted.is-outlined[disabled],fieldset[disabled] .button.is-white.is-inverted.is-outlined{background-color:transparent;border-color:#0a0a0a;box-shadow:none;color:#0a0a0a}.button.is-black{background-color:#0a0a0a;border-color:transparent;color:#fff}.button.is-black.is-hovered,.button.is-black:hover{background-color:#040404;border-color:transparent;color:#fff}.button.is-black.is-focused,.button.is-black:focus{border-color:transparent;color:#fff}.button.is-black.is-focused:not(:active),.button.is-black:focus:not(:active){box-shadow:0 0 0 .125em rgba(10,10,10,.25)}.button.is-black.is-active,.button.is-black:active{background-color:#000;border-color:transparent;color:#fff}.button.is-black[disabled],fieldset[disabled] .button.is-black{background-color:#0a0a0a;border-color:transparent;box-shadow:none}.button.is-black.is-inverted{background-color:#fff;color:#0a0a0a}.button.is-black.is-inverted.is-hovered,.button.is-black.is-inverted:hover{background-color:#f2f2f2}.button.is-black.is-inverted[disabled],fieldset[disabled] .button.is-black.is-inverted{background-color:#fff;border-color:transparent;box-shadow:none;color:#0a0a0a}.button.is-black.is-loading::after{border-color:transparent transparent #fff #fff!important}.button.is-black.is-outlined{background-color:transparent;border-color:#0a0a0a;color:#0a0a0a}.button.is-black.is-outlined.is-focused,.button.is-black.is-outlined.is-hovered,.button.is-black.is-outlined:focus,.button.is-black.is-outlined:hover{background-color:#0a0a0a;border-color:#0a0a0a;color:#fff}.button.is-black.is-outlined.is-loading::after{border-color:transparent transparent #0a0a0a #0a0a0a!important}.button.is-black.is-outlined.is-loading.is-focused::after,.button.is-black.is-outlined.is-loading.is-hovered::after,.button.is-black.is-outlined.is-loading:focus::after,.button.is-black.is-outlined.is-loading:hover::after{border-color:transparent transparent #fff #fff!important}.button.is-black.is-outlined[disabled],fieldset[disabled] .button.is-black.is-outlined{background-color:transparent;border-color:#0a0a0a;box-shadow:none;color:#0a0a0a}.button.is-black.is-inverted.is-outlined{background-color:transparent;border-color:#fff;color:#fff}.button.is-black.is-inverted.is-outlined.is-focused,.button.is-black.is-inverted.is-outlined.is-hovered,.button.is-black.is-inverted.is-outlined:focus,.button.is-black.is-inverted.is-outlined:hover{background-color:#fff;color:#0a0a0a}.button.is-black.is-inverted.is-outlined.is-loading.is-focused::after,.button.is-black.is-inverted.is-outlined.is-loading.is-hovered::after,.button.is-black.is-inverted.is-outlined.is-loading:focus::after,.button.is-black.is-inverted.is-outlined.is-loading:hover::after{border-color:transparent transparent #0a0a0a #0a0a0a!important}.button.is-black.is-inverted.is-outlined[disabled],fieldset[disabled] .button.is-black.is-inverted.is-outlined{background-color:transparent;border-color:#fff;box-shadow:none;color:#fff}.button.is-light{background-color:#f5f5f5;border-color:transparent;color:rgba(0,0,0,.7)}.button.is-light.is-hovered,.button.is-light:hover{background-color:#eee;border-color:transparent;color:rgba(0,0,0,.7)}.button.is-light.is-focused,.button.is-light:focus{border-color:transparent;color:rgba(0,0,0,.7)}.button.is-light.is-focused:not(:active),.button.is-light:focus:not(:active){box-shadow:0 0 0 .125em rgba(245,245,245,.25)}.button.is-light.is-active,.button.is-light:active{background-color:#e8e8e8;border-color:transparent;color:rgba(0,0,0,.7)}.button.is-light[disabled],fieldset[disabled] .button.is-light{background-color:#f5f5f5;border-color:transparent;box-shadow:none}.button.is-light.is-inverted{background-color:rgba(0,0,0,.7);color:#f5f5f5}.button.is-light.is-inverted.is-hovered,.button.is-light.is-inverted:hover{background-color:rgba(0,0,0,.7)}.button.is-light.is-inverted[disabled],fieldset[disabled] .button.is-light.is-inverted{background-color:rgba(0,0,0,.7);border-color:transparent;box-shadow:none;color:#f5f5f5}.button.is-light.is-loading::after{border-color:transparent transparent rgba(0,0,0,.7) rgba(0,0,0,.7)!important}.button.is-light.is-outlined{background-color:transparent;border-color:#f5f5f5;color:#f5f5f5}.button.is-light.is-outlined.is-focused,.button.is-light.is-outlined.is-hovered,.button.is-light.is-outlined:focus,.button.is-light.is-outlined:hover{background-color:#f5f5f5;border-color:#f5f5f5;color:rgba(0,0,0,.7)}.button.is-light.is-outlined.is-loading::after{border-color:transparent transparent #f5f5f5 #f5f5f5!important}.button.is-light.is-outlined.is-loading.is-focused::after,.button.is-light.is-outlined.is-loading.is-hovered::after,.button.is-light.is-outlined.is-loading:focus::after,.button.is-light.is-outlined.is-loading:hover::after{border-color:transparent transparent rgba(0,0,0,.7) rgba(0,0,0,.7)!important}.button.is-light.is-outlined[disabled],fieldset[disabled] .button.is-light.is-outlined{background-color:transparent;border-color:#f5f5f5;box-shadow:none;color:#f5f5f5}.button.is-light.is-inverted.is-outlined{background-color:transparent;border-color:rgba(0,0,0,.7);color:rgba(0,0,0,.7)}.button.is-light.is-inverted.is-outlined.is-focused,.button.is-light.is-inverted.is-outlined.is-hovered,.button.is-light.is-inverted.is-outlined:focus,.button.is-light.is-inverted.is-outlined:hover{background-color:rgba(0,0,0,.7);color:#f5f5f5}.button.is-light.is-inverted.is-outlined.is-loading.is-focused::after,.button.is-light.is-inverted.is-outlined.is-loading.is-hovered::after,.button.is-light.is-inverted.is-outlined.is-loading:focus::after,.button.is-light.is-inverted.is-outlined.is-loading:hover::after{border-color:transparent transparent #f5f5f5 #f5f5f5!important}.button.is-light.is-inverted.is-outlined[disabled],fieldset[disabled] .button.is-light.is-inverted.is-outlined{background-color:transparent;border-color:rgba(0,0,0,.7);box-shadow:none;color:rgba(0,0,0,.7)}.button.is-dark{background-color:#363636;border-color:transparent;color:#fff}.button.is-dark.is-hovered,.button.is-dark:hover{background-color:#2f2f2f;border-color:transparent;color:#fff}.button.is-dark.is-focused,.button.is-dark:focus{border-color:transparent;color:#fff}.button.is-dark.is-focused:not(:active),.button.is-dark:focus:not(:active){box-shadow:0 0 0 .125em rgba(54,54,54,.25)}.button.is-dark.is-active,.button.is-dark:active{background-color:#292929;border-color:transparent;color:#fff}.button.is-dark[disabled],fieldset[disabled] .button.is-dark{background-color:#363636;border-color:transparent;box-shadow:none}.button.is-dark.is-inverted{background-color:#fff;color:#363636}.button.is-dark.is-inverted.is-hovered,.button.is-dark.is-inverted:hover{background-color:#f2f2f2}.button.is-dark.is-inverted[disabled],fieldset[disabled] .button.is-dark.is-inverted{background-color:#fff;border-color:transparent;box-shadow:none;color:#363636}.button.is-dark.is-loading::after{border-color:transparent transparent #fff #fff!important}.button.is-dark.is-outlined{background-color:transparent;border-color:#363636;color:#363636}.button.is-dark.is-outlined.is-focused,.button.is-dark.is-outlined.is-hovered,.button.is-dark.is-outlined:focus,.button.is-dark.is-outlined:hover{background-color:#363636;border-color:#363636;color:#fff}.button.is-dark.is-outlined.is-loading::after{border-color:transparent transparent #363636 #363636!important}.button.is-dark.is-outlined.is-loading.is-focused::after,.button.is-dark.is-outlined.is-loading.is-hovered::after,.button.is-dark.is-outlined.is-loading:focus::after,.button.is-dark.is-outlined.is-loading:hover::after{border-color:transparent transparent #fff #fff!important}.button.is-dark.is-outlined[disabled],fieldset[disabled] .button.is-dark.is-outlined{background-color:transparent;border-color:#363636;box-shadow:none;color:#363636}.button.is-dark.is-inverted.is-outlined{background-color:transparent;border-color:#fff;color:#fff}.button.is-dark.is-inverted.is-outlined.is-focused,.button.is-dark.is-inverted.is-outlined.is-hovered,.button.is-dark.is-inverted.is-outlined:focus,.button.is-dark.is-inverted.is-outlined:hover{background-color:#fff;color:#363636}.button.is-dark.is-inverted.is-outlined.is-loading.is-focused::after,.button.is-dark.is-inverted.is-outlined.is-loading.is-hovered::after,.button.is-dark.is-inverted.is-outlined.is-loading:focus::after,.button.is-dark.is-inverted.is-outlined.is-loading:hover::after{border-color:transparent transparent #363636 #363636!important}.button.is-dark.is-inverted.is-outlined[disabled],fieldset[disabled] .button.is-dark.is-inverted.is-outlined{background-color:transparent;border-color:#fff;box-shadow:none;color:#fff}.button.is-primary{background-color:#00d1b2;border-color:transparent;color:#fff}.button.is-primary.is-hovered,.button.is-primary:hover{background-color:#00c4a7;border-color:transparent;color:#fff}.button.is-primary.is-focused,.button.is-primary:focus{border-color:transparent;color:#fff}.button.is-primary.is-focused:not(:active),.button.is-primary:focus:not(:active){box-shadow:0 0 0 .125em rgba(0,209,178,.25)}.button.is-primary.is-active,.button.is-primary:active{background-color:#00b89c;border-color:transparent;color:#fff}.button.is-primary[disabled],fieldset[disabled] .button.is-primary{background-color:#00d1b2;border-color:transparent;box-shadow:none}.button.is-primary.is-inverted{background-color:#fff;color:#00d1b2}.button.is-primary.is-inverted.is-hovered,.button.is-primary.is-inverted:hover{background-color:#f2f2f2}.button.is-primary.is-inverted[disabled],fieldset[disabled] .button.is-primary.is-inverted{background-color:#fff;border-color:transparent;box-shadow:none;color:#00d1b2}.button.is-primary.is-loading::after{border-color:transparent transparent #fff #fff!important}.button.is-primary.is-outlined{background-color:transparent;border-color:#00d1b2;color:#00d1b2}.button.is-primary.is-outlined.is-focused,.button.is-primary.is-outlined.is-hovered,.button.is-primary.is-outlined:focus,.button.is-primary.is-outlined:hover{background-color:#00d1b2;border-color:#00d1b2;color:#fff}.button.is-primary.is-outlined.is-loading::after{border-color:transparent transparent #00d1b2 #00d1b2!important}.button.is-primary.is-outlined.is-loading.is-focused::after,.button.is-primary.is-outlined.is-loading.is-hovered::after,.button.is-primary.is-outlined.is-loading:focus::after,.button.is-primary.is-outlined.is-loading:hover::after{border-color:transparent transparent #fff #fff!important}.button.is-primary.is-outlined[disabled],fieldset[disabled] .button.is-primary.is-outlined{background-color:transparent;border-color:#00d1b2;box-shadow:none;color:#00d1b2}.button.is-primary.is-inverted.is-outlined{background-color:transparent;border-color:#fff;color:#fff}.button.is-primary.is-inverted.is-outlined.is-focused,.button.is-primary.is-inverted.is-outlined.is-hovered,.button.is-primary.is-inverted.is-outlined:focus,.button.is-primary.is-inverted.is-outlined:hover{background-color:#fff;color:#00d1b2}.button.is-primary.is-inverted.is-outlined.is-loading.is-focused::after,.button.is-primary.is-inverted.is-outlined.is-loading.is-hovered::after,.button.is-primary.is-inverted.is-outlined.is-loading:focus::after,.button.is-primary.is-inverted.is-outlined.is-loading:hover::after{border-color:transparent transparent #00d1b2 #00d1b2!important}.button.is-primary.is-inverted.is-outlined[disabled],fieldset[disabled] .button.is-primary.is-inverted.is-outlined{background-color:transparent;border-color:#fff;box-shadow:none;color:#fff}.button.is-primary.is-light{background-color:#ebfffc;color:#00947e}.button.is-primary.is-light.is-hovered,.button.is-primary.is-light:hover{background-color:#defffa;border-color:transparent;color:#00947e}.button.is-primary.is-light.is-active,.button.is-primary.is-light:active{background-color:#d1fff8;border-color:transparent;color:#00947e}.button.is-link{background-color:#3273dc;border-color:transparent;color:#fff}.button.is-link.is-hovered,.button.is-link:hover{background-color:#276cda;border-color:transparent;color:#fff}.button.is-link.is-focused,.button.is-link:focus{border-color:transparent;color:#fff}.button.is-link.is-focused:not(:active),.button.is-link:focus:not(:active){box-shadow:0 0 0 .125em rgba(50,115,220,.25)}.button.is-link.is-active,.button.is-link:active{background-color:#2366d1;border-color:transparent;color:#fff}.button.is-link[disabled],fieldset[disabled] .button.is-link{background-color:#3273dc;border-color:transparent;box-shadow:none}.button.is-link.is-inverted{background-color:#fff;color:#3273dc}.button.is-link.is-inverted.is-hovered,.button.is-link.is-inverted:hover{background-color:#f2f2f2}.button.is-link.is-inverted[disabled],fieldset[disabled] .button.is-link.is-inverted{background-color:#fff;border-color:transparent;box-shadow:none;color:#3273dc}.button.is-link.is-loading::after{border-color:transparent transparent #fff #fff!important}.button.is-link.is-outlined{background-color:transparent;border-color:#3273dc;color:#3273dc}.button.is-link.is-outlined.is-focused,.button.is-link.is-outlined.is-hovered,.button.is-link.is-outlined:focus,.button.is-link.is-outlined:hover{background-color:#3273dc;border-color:#3273dc;color:#fff}.button.is-link.is-outlined.is-loading::after{border-color:transparent transparent #3273dc #3273dc!important}.button.is-link.is-outlined.is-loading.is-focused::after,.button.is-link.is-outlined.is-loading.is-hovered::after,.button.is-link.is-outlined.is-loading:focus::after,.button.is-link.is-outlined.is-loading:hover::after{border-color:transparent transparent #fff #fff!important}.button.is-link.is-outlined[disabled],fieldset[disabled] .button.is-link.is-outlined{background-color:transparent;border-color:#3273dc;box-shadow:none;color:#3273dc}.button.is-link.is-inverted.is-outlined{background-color:transparent;border-color:#fff;color:#fff}.button.is-link.is-inverted.is-outlined.is-focused,.button.is-link.is-inverted.is-outlined.is-hovered,.button.is-link.is-inverted.is-outlined:focus,.button.is-link.is-inverted.is-outlined:hover{background-color:#fff;color:#3273dc}.button.is-link.is-inverted.is-outlined.is-loading.is-focused::after,.button.is-link.is-inverted.is-outlined.is-loading.is-hovered::after,.button.is-link.is-inverted.is-outlined.is-loading:focus::after,.button.is-link.is-inverted.is-outlined.is-loading:hover::after{border-color:transparent transparent #3273dc #3273dc!important}.button.is-link.is-inverted.is-outlined[disabled],fieldset[disabled] .button.is-link.is-inverted.is-outlined{background-color:transparent;border-color:#fff;box-shadow:none;color:#fff}.button.is-link.is-light{background-color:#eef3fc;color:#2160c4}.button.is-link.is-light.is-hovered,.button.is-link.is-light:hover{background-color:#e3ecfa;border-color:transparent;color:#2160c4}.button.is-link.is-light.is-active,.button.is-link.is-light:active{background-color:#d8e4f8;border-color:transparent;color:#2160c4}.button.is-info{background-color:#3298dc;border-color:transparent;color:#fff}.button.is-info.is-hovered,.button.is-info:hover{background-color:#2793da;border-color:transparent;color:#fff}.button.is-info.is-focused,.button.is-info:focus{border-color:transparent;color:#fff}.button.is-info.is-focused:not(:active),.button.is-info:focus:not(:active){box-shadow:0 0 0 .125em rgba(50,152,220,.25)}.button.is-info.is-active,.button.is-info:active{background-color:#238cd1;border-color:transparent;color:#fff}.button.is-info[disabled],fieldset[disabled] .button.is-info{background-color:#3298dc;border-color:transparent;box-shadow:none}.button.is-info.is-inverted{background-color:#fff;color:#3298dc}.button.is-info.is-inverted.is-hovered,.button.is-info.is-inverted:hover{background-color:#f2f2f2}.button.is-info.is-inverted[disabled],fieldset[disabled] .button.is-info.is-inverted{background-color:#fff;border-color:transparent;box-shadow:none;color:#3298dc}.button.is-info.is-loading::after{border-color:transparent transparent #fff #fff!important}.button.is-info.is-outlined{background-color:transparent;border-color:#3298dc;color:#3298dc}.button.is-info.is-outlined.is-focused,.button.is-info.is-outlined.is-hovered,.button.is-info.is-outlined:focus,.button.is-info.is-outlined:hover{background-color:#3298dc;border-color:#3298dc;color:#fff}.button.is-info.is-outlined.is-loading::after{border-color:transparent transparent #3298dc #3298dc!important}.button.is-info.is-outlined.is-loading.is-focused::after,.button.is-info.is-outlined.is-loading.is-hovered::after,.button.is-info.is-outlined.is-loading:focus::after,.button.is-info.is-outlined.is-loading:hover::after{border-color:transparent transparent #fff #fff!important}.button.is-info.is-outlined[disabled],fieldset[disabled] .button.is-info.is-outlined{background-color:transparent;border-color:#3298dc;box-shadow:none;color:#3298dc}.button.is-info.is-inverted.is-outlined{background-color:transparent;border-color:#fff;color:#fff}.button.is-info.is-inverted.is-outlined.is-focused,.button.is-info.is-inverted.is-outlined.is-hovered,.button.is-info.is-inverted.is-outlined:focus,.button.is-info.is-inverted.is-outlined:hover{background-color:#fff;color:#3298dc}.button.is-info.is-inverted.is-outlined.is-loading.is-focused::after,.button.is-info.is-inverted.is-outlined.is-loading.is-hovered::after,.button.is-info.is-inverted.is-outlined.is-loading:focus::after,.button.is-info.is-inverted.is-outlined.is-loading:hover::after{border-color:transparent transparent #3298dc #3298dc!important}.button.is-info.is-inverted.is-outlined[disabled],fieldset[disabled] .button.is-info.is-inverted.is-outlined{background-color:transparent;border-color:#fff;box-shadow:none;color:#fff}.button.is-info.is-light{background-color:#eef6fc;color:#1d72aa}.button.is-info.is-light.is-hovered,.button.is-info.is-light:hover{background-color:#e3f1fa;border-color:transparent;color:#1d72aa}.button.is-info.is-light.is-active,.button.is-info.is-light:active{background-color:#d8ebf8;border-color:transparent;color:#1d72aa}.button.is-success{background-color:#48c774;border-color:transparent;color:#fff}.button.is-success.is-hovered,.button.is-success:hover{background-color:#3ec46d;border-color:transparent;color:#fff}.button.is-success.is-focused,.button.is-success:focus{border-color:transparent;color:#fff}.button.is-success.is-focused:not(:active),.button.is-success:focus:not(:active){box-shadow:0 0 0 .125em rgba(72,199,116,.25)}.button.is-success.is-active,.button.is-success:active{background-color:#3abb67;border-color:transparent;color:#fff}.button.is-success[disabled],fieldset[disabled] .button.is-success{background-color:#48c774;border-color:transparent;box-shadow:none}.button.is-success.is-inverted{background-color:#fff;color:#48c774}.button.is-success.is-inverted.is-hovered,.button.is-success.is-inverted:hover{background-color:#f2f2f2}.button.is-success.is-inverted[disabled],fieldset[disabled] .button.is-success.is-inverted{background-color:#fff;border-color:transparent;box-shadow:none;color:#48c774}.button.is-success.is-loading::after{border-color:transparent transparent #fff #fff!important}.button.is-success.is-outlined{background-color:transparent;border-color:#48c774;color:#48c774}.button.is-success.is-outlined.is-focused,.button.is-success.is-outlined.is-hovered,.button.is-success.is-outlined:focus,.button.is-success.is-outlined:hover{background-color:#48c774;border-color:#48c774;color:#fff}.button.is-success.is-outlined.is-loading::after{border-color:transparent transparent #48c774 #48c774!important}.button.is-success.is-outlined.is-loading.is-focused::after,.button.is-success.is-outlined.is-loading.is-hovered::after,.button.is-success.is-outlined.is-loading:focus::after,.button.is-success.is-outlined.is-loading:hover::after{border-color:transparent transparent #fff #fff!important}.button.is-success.is-outlined[disabled],fieldset[disabled] .button.is-success.is-outlined{background-color:transparent;border-color:#48c774;box-shadow:none;color:#48c774}.button.is-success.is-inverted.is-outlined{background-color:transparent;border-color:#fff;color:#fff}.button.is-success.is-inverted.is-outlined.is-focused,.button.is-success.is-inverted.is-outlined.is-hovered,.button.is-success.is-inverted.is-outlined:focus,.button.is-success.is-inverted.is-outlined:hover{background-color:#fff;color:#48c774}.button.is-success.is-inverted.is-outlined.is-loading.is-focused::after,.button.is-success.is-inverted.is-outlined.is-loading.is-hovered::after,.button.is-success.is-inverted.is-outlined.is-loading:focus::after,.button.is-success.is-inverted.is-outlined.is-loading:hover::after{border-color:transparent transparent #48c774 #48c774!important}.button.is-success.is-inverted.is-outlined[disabled],fieldset[disabled] .button.is-success.is-inverted.is-outlined{background-color:transparent;border-color:#fff;box-shadow:none;color:#fff}.button.is-success.is-light{background-color:#effaf3;color:#257942}.button.is-success.is-light.is-hovered,.button.is-success.is-light:hover{background-color:#e6f7ec;border-color:transparent;color:#257942}.button.is-success.is-light.is-active,.button.is-success.is-light:active{background-color:#dcf4e4;border-color:transparent;color:#257942}.button.is-warning{background-color:#ffdd57;border-color:transparent;color:rgba(0,0,0,.7)}.button.is-warning.is-hovered,.button.is-warning:hover{background-color:#ffdb4a;border-color:transparent;color:rgba(0,0,0,.7)}.button.is-warning.is-focused,.button.is-warning:focus{border-color:transparent;color:rgba(0,0,0,.7)}.button.is-warning.is-focused:not(:active),.button.is-warning:focus:not(:active){box-shadow:0 0 0 .125em rgba(255,221,87,.25)}.button.is-warning.is-active,.button.is-warning:active{background-color:#ffd83d;border-color:transparent;color:rgba(0,0,0,.7)}.button.is-warning[disabled],fieldset[disabled] .button.is-warning{background-color:#ffdd57;border-color:transparent;box-shadow:none}.button.is-warning.is-inverted{background-color:rgba(0,0,0,.7);color:#ffdd57}.button.is-warning.is-inverted.is-hovered,.button.is-warning.is-inverted:hover{background-color:rgba(0,0,0,.7)}.button.is-warning.is-inverted[disabled],fieldset[disabled] .button.is-warning.is-inverted{background-color:rgba(0,0,0,.7);border-color:transparent;box-shadow:none;color:#ffdd57}.button.is-warning.is-loading::after{border-color:transparent transparent rgba(0,0,0,.7) rgba(0,0,0,.7)!important}.button.is-warning.is-outlined{background-color:transparent;border-color:#ffdd57;color:#ffdd57}.button.is-warning.is-outlined.is-focused,.button.is-warning.is-outlined.is-hovered,.button.is-warning.is-outlined:focus,.button.is-warning.is-outlined:hover{background-color:#ffdd57;border-color:#ffdd57;color:rgba(0,0,0,.7)}.button.is-warning.is-outlined.is-loading::after{border-color:transparent transparent #ffdd57 #ffdd57!important}.button.is-warning.is-outlined.is-loading.is-focused::after,.button.is-warning.is-outlined.is-loading.is-hovered::after,.button.is-warning.is-outlined.is-loading:focus::after,.button.is-warning.is-outlined.is-loading:hover::after{border-color:transparent transparent rgba(0,0,0,.7) rgba(0,0,0,.7)!important}.button.is-warning.is-outlined[disabled],fieldset[disabled] .button.is-warning.is-outlined{background-color:transparent;border-color:#ffdd57;box-shadow:none;color:#ffdd57}.button.is-warning.is-inverted.is-outlined{background-color:transparent;border-color:rgba(0,0,0,.7);color:rgba(0,0,0,.7)}.button.is-warning.is-inverted.is-outlined.is-focused,.button.is-warning.is-inverted.is-outlined.is-hovered,.button.is-warning.is-inverted.is-outlined:focus,.button.is-warning.is-inverted.is-outlined:hover{background-color:rgba(0,0,0,.7);color:#ffdd57}.button.is-warning.is-inverted.is-outlined.is-loading.is-focused::after,.button.is-warning.is-inverted.is-outlined.is-loading.is-hovered::after,.button.is-warning.is-inverted.is-outlined.is-loading:focus::after,.button.is-warning.is-inverted.is-outlined.is-loading:hover::after{border-color:transparent transparent #ffdd57 #ffdd57!important}.button.is-warning.is-inverted.is-outlined[disabled],fieldset[disabled] .button.is-warning.is-inverted.is-outlined{background-color:transparent;border-color:rgba(0,0,0,.7);box-shadow:none;color:rgba(0,0,0,.7)}.button.is-warning.is-light{background-color:#fffbeb;color:#947600}.button.is-warning.is-light.is-hovered,.button.is-warning.is-light:hover{background-color:#fff8de;border-color:transparent;color:#947600}.button.is-warning.is-light.is-active,.button.is-warning.is-light:active{background-color:#fff6d1;border-color:transparent;color:#947600}.button.is-danger{background-color:#f14668;border-color:transparent;color:#fff}.button.is-danger.is-hovered,.button.is-danger:hover{background-color:#f03a5f;border-color:transparent;color:#fff}.button.is-danger.is-focused,.button.is-danger:focus{border-color:transparent;color:#fff}.button.is-danger.is-focused:not(:active),.button.is-danger:focus:not(:active){box-shadow:0 0 0 .125em rgba(241,70,104,.25)}.button.is-danger.is-active,.button.is-danger:active{background-color:#ef2e55;border-color:transparent;color:#fff}.button.is-danger[disabled],fieldset[disabled] .button.is-danger{background-color:#f14668;border-color:transparent;box-shadow:none}.button.is-danger.is-inverted{background-color:#fff;color:#f14668}.button.is-danger.is-inverted.is-hovered,.button.is-danger.is-inverted:hover{background-color:#f2f2f2}.button.is-danger.is-inverted[disabled],fieldset[disabled] .button.is-danger.is-inverted{background-color:#fff;border-color:transparent;box-shadow:none;color:#f14668}.button.is-danger.is-loading::after{border-color:transparent transparent #fff #fff!important}.button.is-danger.is-outlined{background-color:transparent;border-color:#f14668;color:#f14668}.button.is-danger.is-outlined.is-focused,.button.is-danger.is-outlined.is-hovered,.button.is-danger.is-outlined:focus,.button.is-danger.is-outlined:hover{background-color:#f14668;border-color:#f14668;color:#fff}.button.is-danger.is-outlined.is-loading::after{border-color:transparent transparent #f14668 #f14668!important}.button.is-danger.is-outlined.is-loading.is-focused::after,.button.is-danger.is-outlined.is-loading.is-hovered::after,.button.is-danger.is-outlined.is-loading:focus::after,.button.is-danger.is-outlined.is-loading:hover::after{border-color:transparent transparent #fff #fff!important}.button.is-danger.is-outlined[disabled],fieldset[disabled] .button.is-danger.is-outlined{background-color:transparent;border-color:#f14668;box-shadow:none;color:#f14668}.button.is-danger.is-inverted.is-outlined{background-color:transparent;border-color:#fff;color:#fff}.button.is-danger.is-inverted.is-outlined.is-focused,.button.is-danger.is-inverted.is-outlined.is-hovered,.button.is-danger.is-inverted.is-outlined:focus,.button.is-danger.is-inverted.is-outlined:hover{background-color:#fff;color:#f14668}.button.is-danger.is-inverted.is-outlined.is-loading.is-focused::after,.button.is-danger.is-inverted.is-outlined.is-loading.is-hovered::after,.button.is-danger.is-inverted.is-outlined.is-loading:focus::after,.button.is-danger.is-inverted.is-outlined.is-loading:hover::after{border-color:transparent transparent #f14668 #f14668!important}.button.is-danger.is-inverted.is-outlined[disabled],fieldset[disabled] .button.is-danger.is-inverted.is-outlined{background-color:transparent;border-color:#fff;box-shadow:none;color:#fff}.button.is-danger.is-light{background-color:#feecf0;color:#cc0f35}.button.is-danger.is-light.is-hovered,.button.is-danger.is-light:hover{background-color:#fde0e6;border-color:transparent;color:#cc0f35}.button.is-danger.is-light.is-active,.button.is-danger.is-light:active{background-color:#fcd4dc;border-color:transparent;color:#cc0f35}.button.is-small{border-radius:2px;font-size:.75rem}.button.is-normal{font-size:1rem}.button.is-medium{font-size:1.25rem}.button.is-large{font-size:1.5rem}.button[disabled],fieldset[disabled] .button{background-color:#fff;border-color:#dbdbdb;box-shadow:none;opacity:.5}.button.is-fullwidth{display:flex;width:100%}.button.is-loading{color:transparent!important;pointer-events:none}.button.is-loading::after{position:absolute;left:calc(50% - (1em / 2));top:calc(50% - (1em / 2));position:absolute!important}.button.is-static{background-color:#f5f5f5;border-color:#dbdbdb;color:#7a7a7a;box-shadow:none;pointer-events:none}.button.is-rounded{border-radius:290486px;padding-left:calc(1em + .25em);padding-right:calc(1em + .25em)}.buttons{align-items:center;display:flex;flex-wrap:wrap;justify-content:flex-start}.buttons .button{margin-bottom:.5rem}.buttons .button:not(:last-child):not(.is-fullwidth){margin-right:.5rem}.buttons:last-child{margin-bottom:-.5rem}.buttons:not(:last-child){margin-bottom:1rem}.buttons.are-small .button:not(.is-normal):not(.is-medium):not(.is-large){border-radius:2px;font-size:.75rem}.buttons.are-medium .button:not(.is-small):not(.is-normal):not(.is-large){font-size:1.25rem}.buttons.are-large .button:not(.is-small):not(.is-normal):not(.is-medium){font-size:1.5rem}.buttons.has-addons .button:not(:first-child){border-bottom-left-radius:0;border-top-left-radius:0}.buttons.has-addons .button:not(:last-child){border-bottom-right-radius:0;border-top-right-radius:0;margin-right:-1px}.buttons.has-addons .button:last-child{margin-right:0}.buttons.has-addons .button.is-hovered,.buttons.has-addons .button:hover{z-index:2}.buttons.has-addons .button.is-active,.buttons.has-addons .button.is-focused,.buttons.has-addons .button.is-selected,.buttons.has-addons .button:active,.buttons.has-addons .button:focus{z-index:3}.buttons.has-addons .button.is-active:hover,.buttons.has-addons .button.is-focused:hover,.buttons.has-addons .button.is-selected:hover,.buttons.has-addons .button:active:hover,.buttons.has-addons .button:focus:hover{z-index:4}.buttons.has-addons .button.is-expanded{flex-grow:1;flex-shrink:1}.buttons.is-centered{justify-content:center}.buttons.is-centered:not(.has-addons) .button:not(.is-fullwidth){margin-left:.25rem;margin-right:.25rem}.buttons.is-right{justify-content:flex-end}.buttons.is-right:not(.has-addons) .button:not(.is-fullwidth){margin-left:.25rem;margin-right:.25rem}.container{flex-grow:1;margin:0 auto;position:relative;width:auto}.container.is-fluid{max-width:none;padding-left:32px;padding-right:32px;width:100%}@media screen and (min-width:1024px){.container{max-width:960px}}@media screen and (max-width:1215px){.container.is-widescreen{max-width:1152px}}@media screen and (max-width:1407px){.container.is-fullhd{max-width:1344px}}@media screen and (min-width:1216px){.container{max-width:1152px}}@media screen and (min-width:1408px){.container{max-width:1344px}}.content li+li{margin-top:.25em}.content blockquote:not(:last-child),.content dl:not(:last-child),.content ol:not(:last-child),.content p:not(:last-child),.content pre:not(:last-child),.content table:not(:last-child),.content ul:not(:last-child){margin-bottom:1em}.content h1,.content h2,.content h3,.content h4,.content h5,.content h6{color:#363636;font-weight:600;line-height:1.125}.content h1{font-size:2em;margin-bottom:.5em}.content h1:not(:first-child){margin-top:1em}.content h2{font-size:1.75em;margin-bottom:.5714em}.content h2:not(:first-child){margin-top:1.1428em}.content h3{font-size:1.5em;margin-bottom:.6666em}.content h3:not(:first-child){margin-top:1.3333em}.content h4{font-size:1.25em;margin-bottom:.8em}.content h5{font-size:1.125em;margin-bottom:.8888em}.content h6{font-size:1em;margin-bottom:1em}.content blockquote{background-color:#f5f5f5;border-left:5px solid #dbdbdb;padding:1.25em 1.5em}.content ol{list-style-position:outside;margin-left:2em;margin-top:1em}.content ol:not([type]){list-style-type:decimal}.content ol:not([type]).is-lower-alpha{list-style-type:lower-alpha}.content ol:not([type]).is-lower-roman{list-style-type:lower-roman}.content ol:not([type]).is-upper-alpha{list-style-type:upper-alpha}.content ol:not([type]).is-upper-roman{list-style-type:upper-roman}.content ul{list-style:disc outside;margin-left:2em;margin-top:1em}.content ul ul{list-style-type:circle;margin-top:.5em}.content ul ul ul{list-style-type:square}.content dd{margin-left:2em}.content figure{margin-left:2em;margin-right:2em;text-align:center}.content figure:not(:first-child){margin-top:2em}.content figure:not(:last-child){margin-bottom:2em}.content figure img{display:inline-block}.content figure figcaption{font-style:italic}.content pre{-webkit-overflow-scrolling:touch;overflow-x:auto;padding:1.25em 1.5em;white-space:pre;word-wrap:normal}.content sub,.content sup{font-size:75%}.content table{width:100%}.content table td,.content table th{border:1px solid #dbdbdb;border-width:0 0 1px;padding:.5em .75em;vertical-align:top}.content table th{color:#363636}.content table th:not([align]){text-align:left}.content table thead td,.content table thead th{border-width:0 0 2px;color:#363636}.content table tfoot td,.content table tfoot th{border-width:2px 0 0;color:#363636}.content table tbody tr:last-child td,.content table tbody tr:last-child th{border-bottom-width:0}.content .tabs li+li{margin-top:0}.content.is-small{font-size:.75rem}.content.is-medium{font-size:1.25rem}.content.is-large{font-size:1.5rem}.icon{align-items:center;display:inline-flex;justify-content:center;height:1.5rem;width:1.5rem}.icon.is-small{height:1rem;width:1rem}.icon.is-medium{height:2rem;width:2rem}.icon.is-large{height:3rem;width:3rem}.image{display:block;position:relative}.image img{display:block;height:auto;width:100%}.image img.is-rounded{border-radius:290486px}.image.is-fullwidth{width:100%}.image.is-16by9 .has-ratio,.image.is-16by9 img,.image.is-1by1 .has-ratio,.image.is-1by1 img,.image.is-1by2 .has-ratio,.image.is-1by2 img,.image.is-1by3 .has-ratio,.image.is-1by3 img,.image.is-2by1 .has-ratio,.image.is-2by1 img,.image.is-2by3 .has-ratio,.image.is-2by3 img,.image.is-3by1 .has-ratio,.image.is-3by1 img,.image.is-3by2 .has-ratio,.image.is-3by2 img,.image.is-3by4 .has-ratio,.image.is-3by4 img,.image.is-3by5 .has-ratio,.image.is-3by5 img,.image.is-4by3 .has-ratio,.image.is-4by3 img,.image.is-4by5 .has-ratio,.image.is-4by5 img,.image.is-5by3 .has-ratio,.image.is-5by3 img,.image.is-5by4 .has-ratio,.image.is-5by4 img,.image.is-9by16 .has-ratio,.image.is-9by16 img,.image.is-square .has-ratio,.image.is-square img{height:100%;width:100%}.image.is-1by1,.image.is-square{padding-top:100%}.image.is-5by4{padding-top:80%}.image.is-4by3{padding-top:75%}.image.is-3by2{padding-top:66.6666%}.image.is-5by3{padding-top:60%}.image.is-16by9{padding-top:56.25%}.image.is-2by1{padding-top:50%}.image.is-3by1{padding-top:33.3333%}.image.is-4by5{padding-top:125%}.image.is-3by4{padding-top:133.3333%}.image.is-2by3{padding-top:150%}.image.is-3by5{padding-top:166.6666%}.image.is-9by16{padding-top:177.7777%}.image.is-1by2{padding-top:200%}.image.is-1by3{padding-top:300%}.image.is-16x16{height:16px;width:16px}.image.is-24x24{height:24px;width:24px}.image.is-32x32{height:32px;width:32px}.image.is-48x48{height:48px;width:48px}.image.is-64x64{height:64px;width:64px}.image.is-96x96{height:96px;width:96px}.image.is-128x128{height:128px;width:128px}.notification{background-color:#f5f5f5;border-radius:4px;padding:1.25rem 2.5rem 1.25rem 1.5rem;position:relative}.notification a:not(.button):not(.dropdown-item){color:currentColor;text-decoration:underline}.notification strong{color:currentColor}.notification code,.notification pre{background:#fff}.notification pre code{background:0 0}.notification>.delete{position:absolute;right:.5rem;top:.5rem}.notification .content,.notification .subtitle,.notification .title{color:currentColor}.notification.is-white{background-color:#fff;color:#0a0a0a}.notification.is-black{background-color:#0a0a0a;color:#fff}.notification.is-light{background-color:#f5f5f5;color:rgba(0,0,0,.7)}.notification.is-dark{background-color:#363636;color:#fff}.notification.is-primary{background-color:#00d1b2;color:#fff}.notification.is-link{background-color:#3273dc;color:#fff}.notification.is-info{background-color:#3298dc;color:#fff}.notification.is-success{background-color:#48c774;color:#fff}.notification.is-warning{background-color:#ffdd57;color:rgba(0,0,0,.7)}.notification.is-danger{background-color:#f14668;color:#fff}.progress{-moz-appearance:none;-webkit-appearance:none;border:none;border-radius:290486px;display:block;height:1rem;overflow:hidden;padding:0;width:100%}.progress::-webkit-progress-bar{background-color:#ededed}.progress::-webkit-progress-value{background-color:#4a4a4a}.progress::-moz-progress-bar{background-color:#4a4a4a}.progress::-ms-fill{background-color:#4a4a4a;border:none}.progress.is-white::-webkit-progress-value{background-color:#fff}.progress.is-white::-moz-progress-bar{background-color:#fff}.progress.is-white::-ms-fill{background-color:#fff}.progress.is-white:indeterminate{background-image:linear-gradient(to right,#fff 30%,#ededed 30%)}.progress.is-black::-webkit-progress-value{background-color:#0a0a0a}.progress.is-black::-moz-progress-bar{background-color:#0a0a0a}.progress.is-black::-ms-fill{background-color:#0a0a0a}.progress.is-black:indeterminate{background-image:linear-gradient(to right,#0a0a0a 30%,#ededed 30%)}.progress.is-light::-webkit-progress-value{background-color:#f5f5f5}.progress.is-light::-moz-progress-bar{background-color:#f5f5f5}.progress.is-light::-ms-fill{background-color:#f5f5f5}.progress.is-light:indeterminate{background-image:linear-gradient(to right,#f5f5f5 30%,#ededed 30%)}.progress.is-dark::-webkit-progress-value{background-color:#363636}.progress.is-dark::-moz-progress-bar{background-color:#363636}.progress.is-dark::-ms-fill{background-color:#363636}.progress.is-dark:indeterminate{background-image:linear-gradient(to right,#363636 30%,#ededed 30%)}.progress.is-primary::-webkit-progress-value{background-color:#00d1b2}.progress.is-primary::-moz-progress-bar{background-color:#00d1b2}.progress.is-primary::-ms-fill{background-color:#00d1b2}.progress.is-primary:indeterminate{background-image:linear-gradient(to right,#00d1b2 30%,#ededed 30%)}.progress.is-link::-webkit-progress-value{background-color:#3273dc}.progress.is-link::-moz-progress-bar{background-color:#3273dc}.progress.is-link::-ms-fill{background-color:#3273dc}.progress.is-link:indeterminate{background-image:linear-gradient(to right,#3273dc 30%,#ededed 30%)}.progress.is-info::-webkit-progress-value{background-color:#3298dc}.progress.is-info::-moz-progress-bar{background-color:#3298dc}.progress.is-info::-ms-fill{background-color:#3298dc}.progress.is-info:indeterminate{background-image:linear-gradient(to right,#3298dc 30%,#ededed 30%)}.progress.is-success::-webkit-progress-value{background-color:#48c774}.progress.is-success::-moz-progress-bar{background-color:#48c774}.progress.is-success::-ms-fill{background-color:#48c774}.progress.is-success:indeterminate{background-image:linear-gradient(to right,#48c774 30%,#ededed 30%)}.progress.is-warning::-webkit-progress-value{background-color:#ffdd57}.progress.is-warning::-moz-progress-bar{background-color:#ffdd57}.progress.is-warning::-ms-fill{background-color:#ffdd57}.progress.is-warning:indeterminate{background-image:linear-gradient(to right,#ffdd57 30%,#ededed 30%)}.progress.is-danger::-webkit-progress-value{background-color:#f14668}.progress.is-danger::-moz-progress-bar{background-color:#f14668}.progress.is-danger::-ms-fill{background-color:#f14668}.progress.is-danger:indeterminate{background-image:linear-gradient(to right,#f14668 30%,#ededed 30%)}.progress:indeterminate{-webkit-animation-duration:1.5s;animation-duration:1.5s;-webkit-animation-iteration-count:infinite;animation-iteration-count:infinite;-webkit-animation-name:moveIndeterminate;animation-name:moveIndeterminate;-webkit-animation-timing-function:linear;animation-timing-function:linear;background-color:#ededed;background-image:linear-gradient(to right,#4a4a4a 30%,#ededed 30%);background-position:top left;background-repeat:no-repeat;background-size:150% 150%}.progress:indeterminate::-webkit-progress-bar{background-color:transparent}.progress:indeterminate::-moz-progress-bar{background-color:transparent}.progress.is-small{height:.75rem}.progress.is-medium{height:1.25rem}.progress.is-large{height:1.5rem}@-webkit-keyframes moveIndeterminate{from{background-position:200% 0}to{background-position:-200% 0}}@keyframes moveIndeterminate{from{background-position:200% 0}to{background-position:-200% 0}}.table{background-color:#fff;color:#363636}.table td,.table th{border:1px solid #dbdbdb;border-width:0 0 1px;padding:.5em .75em;vertical-align:top}.table td.is-white,.table th.is-white{background-color:#fff;border-color:#fff;color:#0a0a0a}.table td.is-black,.table th.is-black{background-color:#0a0a0a;border-color:#0a0a0a;color:#fff}.table td.is-light,.table th.is-light{background-color:#f5f5f5;border-color:#f5f5f5;color:rgba(0,0,0,.7)}.table td.is-dark,.table th.is-dark{background-color:#363636;border-color:#363636;color:#fff}.table td.is-primary,.table th.is-primary{background-color:#00d1b2;border-color:#00d1b2;color:#fff}.table td.is-link,.table th.is-link{background-color:#3273dc;border-color:#3273dc;color:#fff}.table td.is-info,.table th.is-info{background-color:#3298dc;border-color:#3298dc;color:#fff}.table td.is-success,.table th.is-success{background-color:#48c774;border-color:#48c774;color:#fff}.table td.is-warning,.table th.is-warning{background-color:#ffdd57;border-color:#ffdd57;color:rgba(0,0,0,.7)}.table td.is-danger,.table th.is-danger{background-color:#f14668;border-color:#f14668;color:#fff}.table td.is-narrow,.table th.is-narrow{white-space:nowrap;width:1%}.table td.is-selected,.table th.is-selected{background-color:#00d1b2;color:#fff}.table td.is-selected a,.table td.is-selected strong,.table th.is-selected a,.table th.is-selected strong{color:currentColor}.table th{color:#363636}.table th:not([align]){text-align:left}.table tr.is-selected{background-color:#00d1b2;color:#fff}.table tr.is-selected a,.table tr.is-selected strong{color:currentColor}.table tr.is-selected td,.table tr.is-selected th{border-color:#fff;color:currentColor}.table thead{background-color:transparent}.table thead td,.table thead th{border-width:0 0 2px;color:#363636}.table tfoot{background-color:transparent}.table tfoot td,.table tfoot th{border-width:2px 0 0;color:#363636}.table tbody{background-color:transparent}.table tbody tr:last-child td,.table tbody tr:last-child th{border-bottom-width:0}.table.is-bordered td,.table.is-bordered th{border-width:1px}.table.is-bordered tr:last-child td,.table.is-bordered tr:last-child th{border-bottom-width:1px}.table.is-fullwidth{width:100%}.table.is-hoverable tbody tr:not(.is-selected):hover{background-color:#fafafa}.table.is-hoverable.is-striped tbody tr:not(.is-selected):hover{background-color:#fafafa}.table.is-hoverable.is-striped tbody tr:not(.is-selected):hover:nth-child(even){background-color:#f5f5f5}.table.is-narrow td,.table.is-narrow th{padding:.25em .5em}.table.is-striped tbody tr:not(.is-selected):nth-child(even){background-color:#fafafa}.table-container{-webkit-overflow-scrolling:touch;overflow:auto;overflow-y:hidden;max-width:100%}.tags{align-items:center;display:flex;flex-wrap:wrap;justify-content:flex-start}.tags .tag{margin-bottom:.5rem}.tags .tag:not(:last-child){margin-right:.5rem}.tags:last-child{margin-bottom:-.5rem}.tags:not(:last-child){margin-bottom:1rem}.tags.are-medium .tag:not(.is-normal):not(.is-large){font-size:1rem}.tags.are-large .tag:not(.is-normal):not(.is-medium){font-size:1.25rem}.tags.is-centered{justify-content:center}.tags.is-centered .tag{margin-right:.25rem;margin-left:.25rem}.tags.is-right{justify-content:flex-end}.tags.is-right .tag:not(:first-child){margin-left:.5rem}.tags.is-right .tag:not(:last-child){margin-right:0}.tags.has-addons .tag{margin-right:0}.tags.has-addons .tag:not(:first-child){margin-left:0;border-bottom-left-radius:0;border-top-left-radius:0}.tags.has-addons .tag:not(:last-child){border-bottom-right-radius:0;border-top-right-radius:0}.tag:not(body){align-items:center;background-color:#f5f5f5;border-radius:4px;color:#4a4a4a;display:inline-flex;font-size:.75rem;height:2em;justify-content:center;line-height:1.5;padding-left:.75em;padding-right:.75em;white-space:nowrap}.tag:not(body) .delete{margin-left:.25rem;margin-right:-.375rem}.tag:not(body).is-white{background-color:#fff;color:#0a0a0a}.tag:not(body).is-black{background-color:#0a0a0a;color:#fff}.tag:not(body).is-light{background-color:#f5f5f5;color:rgba(0,0,0,.7)}.tag:not(body).is-dark{background-color:#363636;color:#fff}.tag:not(body).is-primary{background-color:#00d1b2;color:#fff}.tag:not(body).is-primary.is-light{background-color:#ebfffc;color:#00947e}.tag:not(body).is-link{background-color:#3273dc;color:#fff}.tag:not(body).is-link.is-light{background-color:#eef3fc;color:#2160c4}.tag:not(body).is-info{background-color:#3298dc;color:#fff}.tag:not(body).is-info.is-light{background-color:#eef6fc;color:#1d72aa}.tag:not(body).is-success{background-color:#48c774;color:#fff}.tag:not(body).is-success.is-light{background-color:#effaf3;color:#257942}.tag:not(body).is-warning{background-color:#ffdd57;color:rgba(0,0,0,.7)}.tag:not(body).is-warning.is-light{background-color:#fffbeb;color:#947600}.tag:not(body).is-danger{background-color:#f14668;color:#fff}.tag:not(body).is-danger.is-light{background-color:#feecf0;color:#cc0f35}.tag:not(body).is-normal{font-size:.75rem}.tag:not(body).is-medium{font-size:1rem}.tag:not(body).is-large{font-size:1.25rem}.tag:not(body) .icon:first-child:not(:last-child){margin-left:-.375em;margin-right:.1875em}.tag:not(body) .icon:last-child:not(:first-child){margin-left:.1875em;margin-right:-.375em}.tag:not(body) .icon:first-child:last-child{margin-left:-.375em;margin-right:-.375em}.tag:not(body).is-delete{margin-left:1px;padding:0;position:relative;width:2em}.tag:not(body).is-delete::after,.tag:not(body).is-delete::before{background-color:currentColor;content:\"\";display:block;left:50%;position:absolute;top:50%;transform:translateX(-50%) translateY(-50%) rotate(45deg);transform-origin:center center}.tag:not(body).is-delete::before{height:1px;width:50%}.tag:not(body).is-delete::after{height:50%;width:1px}.tag:not(body).is-delete:focus,.tag:not(body).is-delete:hover{background-color:#e8e8e8}.tag:not(body).is-delete:active{background-color:#dbdbdb}.tag:not(body).is-rounded{border-radius:290486px}a.tag:hover{text-decoration:underline}.subtitle,.title{word-break:break-word}.subtitle em,.subtitle span,.title em,.title span{font-weight:inherit}.subtitle sub,.title sub{font-size:.75em}.subtitle sup,.title sup{font-size:.75em}.subtitle .tag,.title .tag{vertical-align:middle}.title{color:#363636;font-size:2rem;font-weight:600;line-height:1.125}.title strong{color:inherit;font-weight:inherit}.title+.highlight{margin-top:-.75rem}.title:not(.is-spaced)+.subtitle{margin-top:-1.25rem}.title.is-1{font-size:3rem}.title.is-2{font-size:2.5rem}.title.is-3{font-size:2rem}.title.is-4{font-size:1.5rem}.title.is-5{font-size:1.25rem}.title.is-6{font-size:1rem}.title.is-7{font-size:.75rem}.subtitle{color:#4a4a4a;font-size:1.25rem;font-weight:400;line-height:1.25}.subtitle strong{color:#363636;font-weight:600}.subtitle:not(.is-spaced)+.title{margin-top:-1.25rem}.subtitle.is-1{font-size:3rem}.subtitle.is-2{font-size:2.5rem}.subtitle.is-3{font-size:2rem}.subtitle.is-4{font-size:1.5rem}.subtitle.is-5{font-size:1.25rem}.subtitle.is-6{font-size:1rem}.subtitle.is-7{font-size:.75rem}.heading{display:block;font-size:11px;letter-spacing:1px;margin-bottom:5px;text-transform:uppercase}.highlight{font-weight:400;max-width:100%;overflow:hidden;padding:0}.highlight pre{overflow:auto;max-width:100%}.number{align-items:center;background-color:#f5f5f5;border-radius:290486px;display:inline-flex;font-size:1.25rem;height:2em;justify-content:center;margin-right:1.5rem;min-width:2.5em;padding:.25rem .5rem;text-align:center;vertical-align:top}.input,.select select,.textarea{background-color:#fff;border-color:#dbdbdb;border-radius:4px;color:#363636}.input::-moz-placeholder,.select select::-moz-placeholder,.textarea::-moz-placeholder{color:rgba(54,54,54,.3)}.input::-webkit-input-placeholder,.select select::-webkit-input-placeholder,.textarea::-webkit-input-placeholder{color:rgba(54,54,54,.3)}.input:-moz-placeholder,.select select:-moz-placeholder,.textarea:-moz-placeholder{color:rgba(54,54,54,.3)}.input:-ms-input-placeholder,.select select:-ms-input-placeholder,.textarea:-ms-input-placeholder{color:rgba(54,54,54,.3)}.input:hover,.is-hovered.input,.is-hovered.textarea,.select select.is-hovered,.select select:hover,.textarea:hover{border-color:#b5b5b5}.input:active,.input:focus,.is-active.input,.is-active.textarea,.is-focused.input,.is-focused.textarea,.select select.is-active,.select select.is-focused,.select select:active,.select select:focus,.textarea:active,.textarea:focus{border-color:#3273dc;box-shadow:0 0 0 .125em rgba(50,115,220,.25)}.input[disabled],.select fieldset[disabled] select,.select select[disabled],.textarea[disabled],fieldset[disabled] .input,fieldset[disabled] .select select,fieldset[disabled] .textarea{background-color:#f5f5f5;border-color:#f5f5f5;box-shadow:none;color:#7a7a7a}.input[disabled]::-moz-placeholder,.select fieldset[disabled] select::-moz-placeholder,.select select[disabled]::-moz-placeholder,.textarea[disabled]::-moz-placeholder,fieldset[disabled] .input::-moz-placeholder,fieldset[disabled] .select select::-moz-placeholder,fieldset[disabled] .textarea::-moz-placeholder{color:rgba(122,122,122,.3)}.input[disabled]::-webkit-input-placeholder,.select fieldset[disabled] select::-webkit-input-placeholder,.select select[disabled]::-webkit-input-placeholder,.textarea[disabled]::-webkit-input-placeholder,fieldset[disabled] .input::-webkit-input-placeholder,fieldset[disabled] .select select::-webkit-input-placeholder,fieldset[disabled] .textarea::-webkit-input-placeholder{color:rgba(122,122,122,.3)}.input[disabled]:-moz-placeholder,.select fieldset[disabled] select:-moz-placeholder,.select select[disabled]:-moz-placeholder,.textarea[disabled]:-moz-placeholder,fieldset[disabled] .input:-moz-placeholder,fieldset[disabled] .select select:-moz-placeholder,fieldset[disabled] .textarea:-moz-placeholder{color:rgba(122,122,122,.3)}.input[disabled]:-ms-input-placeholder,.select fieldset[disabled] select:-ms-input-placeholder,.select select[disabled]:-ms-input-placeholder,.textarea[disabled]:-ms-input-placeholder,fieldset[disabled] .input:-ms-input-placeholder,fieldset[disabled] .select select:-ms-input-placeholder,fieldset[disabled] .textarea:-ms-input-placeholder{color:rgba(122,122,122,.3)}.input,.textarea{box-shadow:inset 0 .0625em .125em rgba(10,10,10,.05);max-width:100%;width:100%}.input[readonly],.textarea[readonly]{box-shadow:none}.is-white.input,.is-white.textarea{border-color:#fff}.is-white.input:active,.is-white.input:focus,.is-white.is-active.input,.is-white.is-active.textarea,.is-white.is-focused.input,.is-white.is-focused.textarea,.is-white.textarea:active,.is-white.textarea:focus{box-shadow:0 0 0 .125em rgba(255,255,255,.25)}.is-black.input,.is-black.textarea{border-color:#0a0a0a}.is-black.input:active,.is-black.input:focus,.is-black.is-active.input,.is-black.is-active.textarea,.is-black.is-focused.input,.is-black.is-focused.textarea,.is-black.textarea:active,.is-black.textarea:focus{box-shadow:0 0 0 .125em rgba(10,10,10,.25)}.is-light.input,.is-light.textarea{border-color:#f5f5f5}.is-light.input:active,.is-light.input:focus,.is-light.is-active.input,.is-light.is-active.textarea,.is-light.is-focused.input,.is-light.is-focused.textarea,.is-light.textarea:active,.is-light.textarea:focus{box-shadow:0 0 0 .125em rgba(245,245,245,.25)}.is-dark.input,.is-dark.textarea{border-color:#363636}.is-dark.input:active,.is-dark.input:focus,.is-dark.is-active.input,.is-dark.is-active.textarea,.is-dark.is-focused.input,.is-dark.is-focused.textarea,.is-dark.textarea:active,.is-dark.textarea:focus{box-shadow:0 0 0 .125em rgba(54,54,54,.25)}.is-primary.input,.is-primary.textarea{border-color:#00d1b2}.is-primary.input:active,.is-primary.input:focus,.is-primary.is-active.input,.is-primary.is-active.textarea,.is-primary.is-focused.input,.is-primary.is-focused.textarea,.is-primary.textarea:active,.is-primary.textarea:focus{box-shadow:0 0 0 .125em rgba(0,209,178,.25)}.is-link.input,.is-link.textarea{border-color:#3273dc}.is-link.input:active,.is-link.input:focus,.is-link.is-active.input,.is-link.is-active.textarea,.is-link.is-focused.input,.is-link.is-focused.textarea,.is-link.textarea:active,.is-link.textarea:focus{box-shadow:0 0 0 .125em rgba(50,115,220,.25)}.is-info.input,.is-info.textarea{border-color:#3298dc}.is-info.input:active,.is-info.input:focus,.is-info.is-active.input,.is-info.is-active.textarea,.is-info.is-focused.input,.is-info.is-focused.textarea,.is-info.textarea:active,.is-info.textarea:focus{box-shadow:0 0 0 .125em rgba(50,152,220,.25)}.is-success.input,.is-success.textarea{border-color:#48c774}.is-success.input:active,.is-success.input:focus,.is-success.is-active.input,.is-success.is-active.textarea,.is-success.is-focused.input,.is-success.is-focused.textarea,.is-success.textarea:active,.is-success.textarea:focus{box-shadow:0 0 0 .125em rgba(72,199,116,.25)}.is-warning.input,.is-warning.textarea{border-color:#ffdd57}.is-warning.input:active,.is-warning.input:focus,.is-warning.is-active.input,.is-warning.is-active.textarea,.is-warning.is-focused.input,.is-warning.is-focused.textarea,.is-warning.textarea:active,.is-warning.textarea:focus{box-shadow:0 0 0 .125em rgba(255,221,87,.25)}.is-danger.input,.is-danger.textarea{border-color:#f14668}.is-danger.input:active,.is-danger.input:focus,.is-danger.is-active.input,.is-danger.is-active.textarea,.is-danger.is-focused.input,.is-danger.is-focused.textarea,.is-danger.textarea:active,.is-danger.textarea:focus{box-shadow:0 0 0 .125em rgba(241,70,104,.25)}.is-small.input,.is-small.textarea{border-radius:2px;font-size:.75rem}.is-medium.input,.is-medium.textarea{font-size:1.25rem}.is-large.input,.is-large.textarea{font-size:1.5rem}.is-fullwidth.input,.is-fullwidth.textarea{display:block;width:100%}.is-inline.input,.is-inline.textarea{display:inline;width:auto}.input.is-rounded{border-radius:290486px;padding-left:calc(calc(.75em - 1px) + .375em);padding-right:calc(calc(.75em - 1px) + .375em)}.input.is-static{background-color:transparent;border-color:transparent;box-shadow:none;padding-left:0;padding-right:0}.textarea{display:block;max-width:100%;min-width:100%;padding:calc(.75em - 1px);resize:vertical}.textarea:not([rows]){max-height:40em;min-height:8em}.textarea[rows]{height:initial}.textarea.has-fixed-size{resize:none}.checkbox,.radio{cursor:pointer;display:inline-block;line-height:1.25;position:relative}.checkbox input,.radio input{cursor:pointer}.checkbox:hover,.radio:hover{color:#363636}.checkbox[disabled],.radio[disabled],fieldset[disabled] .checkbox,fieldset[disabled] .radio{color:#7a7a7a;cursor:not-allowed}.radio+.radio{margin-left:.5em}.select{display:inline-block;max-width:100%;position:relative;vertical-align:top}.select:not(.is-multiple){height:2.5em}.select:not(.is-multiple):not(.is-loading)::after{border-color:#3273dc;right:1.125em;z-index:4}.select.is-rounded select{border-radius:290486px;padding-left:1em}.select select{cursor:pointer;display:block;font-size:1em;max-width:100%;outline:0}.select select::-ms-expand{display:none}.select select[disabled]:hover,fieldset[disabled] .select select:hover{border-color:#f5f5f5}.select select:not([multiple]){padding-right:2.5em}.select select[multiple]{height:auto;padding:0}.select select[multiple] option{padding:.5em 1em}.select:not(.is-multiple):not(.is-loading):hover::after{border-color:#363636}.select.is-white:not(:hover)::after{border-color:#fff}.select.is-white select{border-color:#fff}.select.is-white select.is-hovered,.select.is-white select:hover{border-color:#f2f2f2}.select.is-white select.is-active,.select.is-white select.is-focused,.select.is-white select:active,.select.is-white select:focus{box-shadow:0 0 0 .125em rgba(255,255,255,.25)}.select.is-black:not(:hover)::after{border-color:#0a0a0a}.select.is-black select{border-color:#0a0a0a}.select.is-black select.is-hovered,.select.is-black select:hover{border-color:#000}.select.is-black select.is-active,.select.is-black select.is-focused,.select.is-black select:active,.select.is-black select:focus{box-shadow:0 0 0 .125em rgba(10,10,10,.25)}.select.is-light:not(:hover)::after{border-color:#f5f5f5}.select.is-light select{border-color:#f5f5f5}.select.is-light select.is-hovered,.select.is-light select:hover{border-color:#e8e8e8}.select.is-light select.is-active,.select.is-light select.is-focused,.select.is-light select:active,.select.is-light select:focus{box-shadow:0 0 0 .125em rgba(245,245,245,.25)}.select.is-dark:not(:hover)::after{border-color:#363636}.select.is-dark select{border-color:#363636}.select.is-dark select.is-hovered,.select.is-dark select:hover{border-color:#292929}.select.is-dark select.is-active,.select.is-dark select.is-focused,.select.is-dark select:active,.select.is-dark select:focus{box-shadow:0 0 0 .125em rgba(54,54,54,.25)}.select.is-primary:not(:hover)::after{border-color:#00d1b2}.select.is-primary select{border-color:#00d1b2}.select.is-primary select.is-hovered,.select.is-primary select:hover{border-color:#00b89c}.select.is-primary select.is-active,.select.is-primary select.is-focused,.select.is-primary select:active,.select.is-primary select:focus{box-shadow:0 0 0 .125em rgba(0,209,178,.25)}.select.is-link:not(:hover)::after{border-color:#3273dc}.select.is-link select{border-color:#3273dc}.select.is-link select.is-hovered,.select.is-link select:hover{border-color:#2366d1}.select.is-link select.is-active,.select.is-link select.is-focused,.select.is-link select:active,.select.is-link select:focus{box-shadow:0 0 0 .125em rgba(50,115,220,.25)}.select.is-info:not(:hover)::after{border-color:#3298dc}.select.is-info select{border-color:#3298dc}.select.is-info select.is-hovered,.select.is-info select:hover{border-color:#238cd1}.select.is-info select.is-active,.select.is-info select.is-focused,.select.is-info select:active,.select.is-info select:focus{box-shadow:0 0 0 .125em rgba(50,152,220,.25)}.select.is-success:not(:hover)::after{border-color:#48c774}.select.is-success select{border-color:#48c774}.select.is-success select.is-hovered,.select.is-success select:hover{border-color:#3abb67}.select.is-success select.is-active,.select.is-success select.is-focused,.select.is-success select:active,.select.is-success select:focus{box-shadow:0 0 0 .125em rgba(72,199,116,.25)}.select.is-warning:not(:hover)::after{border-color:#ffdd57}.select.is-warning select{border-color:#ffdd57}.select.is-warning select.is-hovered,.select.is-warning select:hover{border-color:#ffd83d}.select.is-warning select.is-active,.select.is-warning select.is-focused,.select.is-warning select:active,.select.is-warning select:focus{box-shadow:0 0 0 .125em rgba(255,221,87,.25)}.select.is-danger:not(:hover)::after{border-color:#f14668}.select.is-danger select{border-color:#f14668}.select.is-danger select.is-hovered,.select.is-danger select:hover{border-color:#ef2e55}.select.is-danger select.is-active,.select.is-danger select.is-focused,.select.is-danger select:active,.select.is-danger select:focus{box-shadow:0 0 0 .125em rgba(241,70,104,.25)}.select.is-small{border-radius:2px;font-size:.75rem}.select.is-medium{font-size:1.25rem}.select.is-large{font-size:1.5rem}.select.is-disabled::after{border-color:#7a7a7a}.select.is-fullwidth{width:100%}.select.is-fullwidth select{width:100%}.select.is-loading::after{margin-top:0;position:absolute;right:.625em;top:.625em;transform:none}.select.is-loading.is-small:after{font-size:.75rem}.select.is-loading.is-medium:after{font-size:1.25rem}.select.is-loading.is-large:after{font-size:1.5rem}.file{align-items:stretch;display:flex;justify-content:flex-start;position:relative}.file.is-white .file-cta{background-color:#fff;border-color:transparent;color:#0a0a0a}.file.is-white.is-hovered .file-cta,.file.is-white:hover .file-cta{background-color:#f9f9f9;border-color:transparent;color:#0a0a0a}.file.is-white.is-focused .file-cta,.file.is-white:focus .file-cta{border-color:transparent;box-shadow:0 0 .5em rgba(255,255,255,.25);color:#0a0a0a}.file.is-white.is-active .file-cta,.file.is-white:active .file-cta{background-color:#f2f2f2;border-color:transparent;color:#0a0a0a}.file.is-black .file-cta{background-color:#0a0a0a;border-color:transparent;color:#fff}.file.is-black.is-hovered .file-cta,.file.is-black:hover .file-cta{background-color:#040404;border-color:transparent;color:#fff}.file.is-black.is-focused .file-cta,.file.is-black:focus .file-cta{border-color:transparent;box-shadow:0 0 .5em rgba(10,10,10,.25);color:#fff}.file.is-black.is-active .file-cta,.file.is-black:active .file-cta{background-color:#000;border-color:transparent;color:#fff}.file.is-light .file-cta{background-color:#f5f5f5;border-color:transparent;color:rgba(0,0,0,.7)}.file.is-light.is-hovered .file-cta,.file.is-light:hover .file-cta{background-color:#eee;border-color:transparent;color:rgba(0,0,0,.7)}.file.is-light.is-focused .file-cta,.file.is-light:focus .file-cta{border-color:transparent;box-shadow:0 0 .5em rgba(245,245,245,.25);color:rgba(0,0,0,.7)}.file.is-light.is-active .file-cta,.file.is-light:active .file-cta{background-color:#e8e8e8;border-color:transparent;color:rgba(0,0,0,.7)}.file.is-dark .file-cta{background-color:#363636;border-color:transparent;color:#fff}.file.is-dark.is-hovered .file-cta,.file.is-dark:hover .file-cta{background-color:#2f2f2f;border-color:transparent;color:#fff}.file.is-dark.is-focused .file-cta,.file.is-dark:focus .file-cta{border-color:transparent;box-shadow:0 0 .5em rgba(54,54,54,.25);color:#fff}.file.is-dark.is-active .file-cta,.file.is-dark:active .file-cta{background-color:#292929;border-color:transparent;color:#fff}.file.is-primary .file-cta{background-color:#00d1b2;border-color:transparent;color:#fff}.file.is-primary.is-hovered .file-cta,.file.is-primary:hover .file-cta{background-color:#00c4a7;border-color:transparent;color:#fff}.file.is-primary.is-focused .file-cta,.file.is-primary:focus .file-cta{border-color:transparent;box-shadow:0 0 .5em rgba(0,209,178,.25);color:#fff}.file.is-primary.is-active .file-cta,.file.is-primary:active .file-cta{background-color:#00b89c;border-color:transparent;color:#fff}.file.is-link .file-cta{background-color:#3273dc;border-color:transparent;color:#fff}.file.is-link.is-hovered .file-cta,.file.is-link:hover .file-cta{background-color:#276cda;border-color:transparent;color:#fff}.file.is-link.is-focused .file-cta,.file.is-link:focus .file-cta{border-color:transparent;box-shadow:0 0 .5em rgba(50,115,220,.25);color:#fff}.file.is-link.is-active .file-cta,.file.is-link:active .file-cta{background-color:#2366d1;border-color:transparent;color:#fff}.file.is-info .file-cta{background-color:#3298dc;border-color:transparent;color:#fff}.file.is-info.is-hovered .file-cta,.file.is-info:hover .file-cta{background-color:#2793da;border-color:transparent;color:#fff}.file.is-info.is-focused .file-cta,.file.is-info:focus .file-cta{border-color:transparent;box-shadow:0 0 .5em rgba(50,152,220,.25);color:#fff}.file.is-info.is-active .file-cta,.file.is-info:active .file-cta{background-color:#238cd1;border-color:transparent;color:#fff}.file.is-success .file-cta{background-color:#48c774;border-color:transparent;color:#fff}.file.is-success.is-hovered .file-cta,.file.is-success:hover .file-cta{background-color:#3ec46d;border-color:transparent;color:#fff}.file.is-success.is-focused .file-cta,.file.is-success:focus .file-cta{border-color:transparent;box-shadow:0 0 .5em rgba(72,199,116,.25);color:#fff}.file.is-success.is-active .file-cta,.file.is-success:active .file-cta{background-color:#3abb67;border-color:transparent;color:#fff}.file.is-warning .file-cta{background-color:#ffdd57;border-color:transparent;color:rgba(0,0,0,.7)}.file.is-warning.is-hovered .file-cta,.file.is-warning:hover .file-cta{background-color:#ffdb4a;border-color:transparent;color:rgba(0,0,0,.7)}.file.is-warning.is-focused .file-cta,.file.is-warning:focus .file-cta{border-color:transparent;box-shadow:0 0 .5em rgba(255,221,87,.25);color:rgba(0,0,0,.7)}.file.is-warning.is-active .file-cta,.file.is-warning:active .file-cta{background-color:#ffd83d;border-color:transparent;color:rgba(0,0,0,.7)}.file.is-danger .file-cta{background-color:#f14668;border-color:transparent;color:#fff}.file.is-danger.is-hovered .file-cta,.file.is-danger:hover .file-cta{background-color:#f03a5f;border-color:transparent;color:#fff}.file.is-danger.is-focused .file-cta,.file.is-danger:focus .file-cta{border-color:transparent;box-shadow:0 0 .5em rgba(241,70,104,.25);color:#fff}.file.is-danger.is-active .file-cta,.file.is-danger:active .file-cta{background-color:#ef2e55;border-color:transparent;color:#fff}.file.is-small{font-size:.75rem}.file.is-medium{font-size:1.25rem}.file.is-medium .file-icon .fa{font-size:21px}.file.is-large{font-size:1.5rem}.file.is-large .file-icon .fa{font-size:28px}.file.has-name .file-cta{border-bottom-right-radius:0;border-top-right-radius:0}.file.has-name .file-name{border-bottom-left-radius:0;border-top-left-radius:0}.file.has-name.is-empty .file-cta{border-radius:4px}.file.has-name.is-empty .file-name{display:none}.file.is-boxed .file-label{flex-direction:column}.file.is-boxed .file-cta{flex-direction:column;height:auto;padding:1em 3em}.file.is-boxed .file-name{border-width:0 1px 1px}.file.is-boxed .file-icon{height:1.5em;width:1.5em}.file.is-boxed .file-icon .fa{font-size:21px}.file.is-boxed.is-small .file-icon .fa{font-size:14px}.file.is-boxed.is-medium .file-icon .fa{font-size:28px}.file.is-boxed.is-large .file-icon .fa{font-size:35px}.file.is-boxed.has-name .file-cta{border-radius:4px 4px 0 0}.file.is-boxed.has-name .file-name{border-radius:0 0 4px 4px;border-width:0 1px 1px}.file.is-centered{justify-content:center}.file.is-fullwidth .file-label{width:100%}.file.is-fullwidth .file-name{flex-grow:1;max-width:none}.file.is-right{justify-content:flex-end}.file.is-right .file-cta{border-radius:0 4px 4px 0}.file.is-right .file-name{border-radius:4px 0 0 4px;border-width:1px 0 1px 1px;order:-1}.file-label{align-items:stretch;display:flex;cursor:pointer;justify-content:flex-start;overflow:hidden;position:relative}.file-label:hover .file-cta{background-color:#eee;color:#363636}.file-label:hover .file-name{border-color:#d5d5d5}.file-label:active .file-cta{background-color:#e8e8e8;color:#363636}.file-label:active .file-name{border-color:#cfcfcf}.file-input{height:100%;left:0;opacity:0;outline:0;position:absolute;top:0;width:100%}.file-cta,.file-name{border-color:#dbdbdb;border-radius:4px;font-size:1em;padding-left:1em;padding-right:1em;white-space:nowrap}.file-cta{background-color:#f5f5f5;color:#4a4a4a}.file-name{border-color:#dbdbdb;border-style:solid;border-width:1px 1px 1px 0;display:block;max-width:16em;overflow:hidden;text-align:left;text-overflow:ellipsis}.file-icon{align-items:center;display:flex;height:1em;justify-content:center;margin-right:.5em;width:1em}.file-icon .fa{font-size:14px}.label{color:#363636;display:block;font-size:1rem;font-weight:700}.label:not(:last-child){margin-bottom:.5em}.label.is-small{font-size:.75rem}.label.is-medium{font-size:1.25rem}.label.is-large{font-size:1.5rem}.help{display:block;font-size:.75rem;margin-top:.25rem}.help.is-white{color:#fff}.help.is-black{color:#0a0a0a}.help.is-light{color:#f5f5f5}.help.is-dark{color:#363636}.help.is-primary{color:#00d1b2}.help.is-link{color:#3273dc}.help.is-info{color:#3298dc}.help.is-success{color:#48c774}.help.is-warning{color:#ffdd57}.help.is-danger{color:#f14668}.field:not(:last-child){margin-bottom:.75rem}.field.has-addons{display:flex;justify-content:flex-start}.field.has-addons .control:not(:last-child){margin-right:-1px}.field.has-addons .control:not(:first-child):not(:last-child) .button,.field.has-addons .control:not(:first-child):not(:last-child) .input,.field.has-addons .control:not(:first-child):not(:last-child) .select select{border-radius:0}.field.has-addons .control:first-child:not(:only-child) .button,.field.has-addons .control:first-child:not(:only-child) .input,.field.has-addons .control:first-child:not(:only-child) .select select{border-bottom-right-radius:0;border-top-right-radius:0}.field.has-addons .control:last-child:not(:only-child) .button,.field.has-addons .control:last-child:not(:only-child) .input,.field.has-addons .control:last-child:not(:only-child) .select select{border-bottom-left-radius:0;border-top-left-radius:0}.field.has-addons .control .button:not([disabled]).is-hovered,.field.has-addons .control .button:not([disabled]):hover,.field.has-addons .control .input:not([disabled]).is-hovered,.field.has-addons .control .input:not([disabled]):hover,.field.has-addons .control .select select:not([disabled]).is-hovered,.field.has-addons .control .select select:not([disabled]):hover{z-index:2}.field.has-addons .control .button:not([disabled]).is-active,.field.has-addons .control .button:not([disabled]).is-focused,.field.has-addons .control .button:not([disabled]):active,.field.has-addons .control .button:not([disabled]):focus,.field.has-addons .control .input:not([disabled]).is-active,.field.has-addons .control .input:not([disabled]).is-focused,.field.has-addons .control .input:not([disabled]):active,.field.has-addons .control .input:not([disabled]):focus,.field.has-addons .control .select select:not([disabled]).is-active,.field.has-addons .control .select select:not([disabled]).is-focused,.field.has-addons .control .select select:not([disabled]):active,.field.has-addons .control .select select:not([disabled]):focus{z-index:3}.field.has-addons .control .button:not([disabled]).is-active:hover,.field.has-addons .control .button:not([disabled]).is-focused:hover,.field.has-addons .control .button:not([disabled]):active:hover,.field.has-addons .control .button:not([disabled]):focus:hover,.field.has-addons .control .input:not([disabled]).is-active:hover,.field.has-addons .control .input:not([disabled]).is-focused:hover,.field.has-addons .control .input:not([disabled]):active:hover,.field.has-addons .control .input:not([disabled]):focus:hover,.field.has-addons .control .select select:not([disabled]).is-active:hover,.field.has-addons .control .select select:not([disabled]).is-focused:hover,.field.has-addons .control .select select:not([disabled]):active:hover,.field.has-addons .control .select select:not([disabled]):focus:hover{z-index:4}.field.has-addons .control.is-expanded{flex-grow:1;flex-shrink:1}.field.has-addons.has-addons-centered{justify-content:center}.field.has-addons.has-addons-right{justify-content:flex-end}.field.has-addons.has-addons-fullwidth .control{flex-grow:1;flex-shrink:0}.field.is-grouped{display:flex;justify-content:flex-start}.field.is-grouped>.control{flex-shrink:0}.field.is-grouped>.control:not(:last-child){margin-bottom:0;margin-right:.75rem}.field.is-grouped>.control.is-expanded{flex-grow:1;flex-shrink:1}.field.is-grouped.is-grouped-centered{justify-content:center}.field.is-grouped.is-grouped-right{justify-content:flex-end}.field.is-grouped.is-grouped-multiline{flex-wrap:wrap}.field.is-grouped.is-grouped-multiline>.control:last-child,.field.is-grouped.is-grouped-multiline>.control:not(:last-child){margin-bottom:.75rem}.field.is-grouped.is-grouped-multiline:last-child{margin-bottom:-.75rem}.field.is-grouped.is-grouped-multiline:not(:last-child){margin-bottom:0}@media screen and (min-width:769px),print{.field.is-horizontal{display:flex}}.field-label .label{font-size:inherit}@media screen and (max-width:768px){.field-label{margin-bottom:.5rem}}@media screen and (min-width:769px),print{.field-label{flex-basis:0;flex-grow:1;flex-shrink:0;margin-right:1.5rem;text-align:right}.field-label.is-small{font-size:.75rem;padding-top:.375em}.field-label.is-normal{padding-top:.375em}.field-label.is-medium{font-size:1.25rem;padding-top:.375em}.field-label.is-large{font-size:1.5rem;padding-top:.375em}}.field-body .field .field{margin-bottom:0}@media screen and (min-width:769px),print{.field-body{display:flex;flex-basis:0;flex-grow:5;flex-shrink:1}.field-body .field{margin-bottom:0}.field-body>.field{flex-shrink:1}.field-body>.field:not(.is-narrow){flex-grow:1}.field-body>.field:not(:last-child){margin-right:.75rem}}.control{box-sizing:border-box;clear:both;font-size:1rem;position:relative;text-align:left}.control.has-icons-left .input:focus~.icon,.control.has-icons-left .select:focus~.icon,.control.has-icons-right .input:focus~.icon,.control.has-icons-right .select:focus~.icon{color:#4a4a4a}.control.has-icons-left .input.is-small~.icon,.control.has-icons-left .select.is-small~.icon,.control.has-icons-right .input.is-small~.icon,.control.has-icons-right .select.is-small~.icon{font-size:.75rem}.control.has-icons-left .input.is-medium~.icon,.control.has-icons-left .select.is-medium~.icon,.control.has-icons-right .input.is-medium~.icon,.control.has-icons-right .select.is-medium~.icon{font-size:1.25rem}.control.has-icons-left .input.is-large~.icon,.control.has-icons-left .select.is-large~.icon,.control.has-icons-right .input.is-large~.icon,.control.has-icons-right .select.is-large~.icon{font-size:1.5rem}.control.has-icons-left .icon,.control.has-icons-right .icon{color:#dbdbdb;height:2.5em;pointer-events:none;position:absolute;top:0;width:2.5em;z-index:4}.control.has-icons-left .input,.control.has-icons-left .select select{padding-left:2.5em}.control.has-icons-left .icon.is-left{left:0}.control.has-icons-right .input,.control.has-icons-right .select select{padding-right:2.5em}.control.has-icons-right .icon.is-right{right:0}.control.is-loading::after{position:absolute!important;right:.625em;top:.625em;z-index:4}.control.is-loading.is-small:after{font-size:.75rem}.control.is-loading.is-medium:after{font-size:1.25rem}.control.is-loading.is-large:after{font-size:1.5rem}.breadcrumb{font-size:1rem;white-space:nowrap}.breadcrumb a{align-items:center;color:#3273dc;display:flex;justify-content:center;padding:0 .75em}.breadcrumb a:hover{color:#363636}.breadcrumb li{align-items:center;display:flex}.breadcrumb li:first-child a{padding-left:0}.breadcrumb li.is-active a{color:#363636;cursor:default;pointer-events:none}.breadcrumb li+li::before{color:#b5b5b5;content:\"\\0002f\"}.breadcrumb ol,.breadcrumb ul{align-items:flex-start;display:flex;flex-wrap:wrap;justify-content:flex-start}.breadcrumb .icon:first-child{margin-right:.5em}.breadcrumb .icon:last-child{margin-left:.5em}.breadcrumb.is-centered ol,.breadcrumb.is-centered ul{justify-content:center}.breadcrumb.is-right ol,.breadcrumb.is-right ul{justify-content:flex-end}.breadcrumb.is-small{font-size:.75rem}.breadcrumb.is-medium{font-size:1.25rem}.breadcrumb.is-large{font-size:1.5rem}.breadcrumb.has-arrow-separator li+li::before{content:\"\\02192\"}.breadcrumb.has-bullet-separator li+li::before{content:\"\\02022\"}.breadcrumb.has-dot-separator li+li::before{content:\"\\000b7\"}.breadcrumb.has-succeeds-separator li+li::before{content:\"\\0227B\"}.card{background-color:#fff;box-shadow:0 .5em 1em -.125em rgba(10,10,10,.1),0 0 0 1px rgba(10,10,10,.02);color:#4a4a4a;max-width:100%;position:relative}.card-header{background-color:transparent;align-items:stretch;box-shadow:0 .125em .25em rgba(10,10,10,.1);display:flex}.card-header-title{align-items:center;color:#363636;display:flex;flex-grow:1;font-weight:700;padding:.75rem 1rem}.card-header-title.is-centered{justify-content:center}.card-header-icon{align-items:center;cursor:pointer;display:flex;justify-content:center;padding:.75rem 1rem}.card-image{display:block;position:relative}.card-content{background-color:transparent;padding:1.5rem}.card-footer{background-color:transparent;border-top:1px solid #ededed;align-items:stretch;display:flex}.card-footer-item{align-items:center;display:flex;flex-basis:0;flex-grow:1;flex-shrink:0;justify-content:center;padding:.75rem}.card-footer-item:not(:last-child){border-right:1px solid #ededed}.card .media:not(:last-child){margin-bottom:1.5rem}.dropdown{display:inline-flex;position:relative;vertical-align:top}.dropdown.is-active .dropdown-menu,.dropdown.is-hoverable:hover .dropdown-menu{display:block}.dropdown.is-right .dropdown-menu{left:auto;right:0}.dropdown.is-up .dropdown-menu{bottom:100%;padding-bottom:4px;padding-top:initial;top:auto}.dropdown-menu{display:none;left:0;min-width:12rem;padding-top:4px;position:absolute;top:100%;z-index:20}.dropdown-content{background-color:#fff;border-radius:4px;box-shadow:0 .5em 1em -.125em rgba(10,10,10,.1),0 0 0 1px rgba(10,10,10,.02);padding-bottom:.5rem;padding-top:.5rem}.dropdown-item{color:#4a4a4a;display:block;font-size:.875rem;line-height:1.5;padding:.375rem 1rem;position:relative}a.dropdown-item,button.dropdown-item{padding-right:3rem;text-align:left;white-space:nowrap;width:100%}a.dropdown-item:hover,button.dropdown-item:hover{background-color:#f5f5f5;color:#0a0a0a}a.dropdown-item.is-active,button.dropdown-item.is-active{background-color:#3273dc;color:#fff}.dropdown-divider{background-color:#ededed;border:none;display:block;height:1px;margin:.5rem 0}.level{align-items:center;justify-content:space-between}.level code{border-radius:4px}.level img{display:inline-block;vertical-align:top}.level.is-mobile{display:flex}.level.is-mobile .level-left,.level.is-mobile .level-right{display:flex}.level.is-mobile .level-left+.level-right{margin-top:0}.level.is-mobile .level-item:not(:last-child){margin-bottom:0;margin-right:.75rem}.level.is-mobile .level-item:not(.is-narrow){flex-grow:1}@media screen and (min-width:769px),print{.level{display:flex}.level>.level-item:not(.is-narrow){flex-grow:1}}.level-item{align-items:center;display:flex;flex-basis:auto;flex-grow:0;flex-shrink:0;justify-content:center}.level-item .subtitle,.level-item .title{margin-bottom:0}@media screen and (max-width:768px){.level-item:not(:last-child){margin-bottom:.75rem}}.level-left,.level-right{flex-basis:auto;flex-grow:0;flex-shrink:0}.level-left .level-item.is-flexible,.level-right .level-item.is-flexible{flex-grow:1}@media screen and (min-width:769px),print{.level-left .level-item:not(:last-child),.level-right .level-item:not(:last-child){margin-right:.75rem}}.level-left{align-items:center;justify-content:flex-start}@media screen and (max-width:768px){.level-left+.level-right{margin-top:1.5rem}}@media screen and (min-width:769px),print{.level-left{display:flex}}.level-right{align-items:center;justify-content:flex-end}@media screen and (min-width:769px),print{.level-right{display:flex}}.list{background-color:#fff;border-radius:4px;box-shadow:0 2px 3px rgba(10,10,10,.1),0 0 0 1px rgba(10,10,10,.1)}.list-item{display:block;padding:.5em 1em}.list-item:not(a){color:#4a4a4a}.list-item:first-child{border-top-left-radius:4px;border-top-right-radius:4px}.list-item:last-child{border-bottom-left-radius:4px;border-bottom-right-radius:4px}.list-item:not(:last-child){border-bottom:1px solid #dbdbdb}.list-item.is-active{background-color:#3273dc;color:#fff}a.list-item{background-color:#f5f5f5;cursor:pointer}.media{align-items:flex-start;display:flex;text-align:left}.media .content:not(:last-child){margin-bottom:.75rem}.media .media{border-top:1px solid rgba(219,219,219,.5);display:flex;padding-top:.75rem}.media .media .content:not(:last-child),.media .media .control:not(:last-child){margin-bottom:.5rem}.media .media .media{padding-top:.5rem}.media .media .media+.media{margin-top:.5rem}.media+.media{border-top:1px solid rgba(219,219,219,.5);margin-top:1rem;padding-top:1rem}.media.is-large+.media{margin-top:1.5rem;padding-top:1.5rem}.media-left,.media-right{flex-basis:auto;flex-grow:0;flex-shrink:0}.media-left{margin-right:1rem}.media-right{margin-left:1rem}.media-content{flex-basis:auto;flex-grow:1;flex-shrink:1;text-align:left}@media screen and (max-width:768px){.media-content{overflow-x:auto}}.menu{font-size:1rem}.menu.is-small{font-size:.75rem}.menu.is-medium{font-size:1.25rem}.menu.is-large{font-size:1.5rem}.menu-list{line-height:1.25}.menu-list a{border-radius:2px;color:#4a4a4a;display:block;padding:.5em .75em}.menu-list a:hover{background-color:#f5f5f5;color:#363636}.menu-list a.is-active{background-color:#3273dc;color:#fff}.menu-list li ul{border-left:1px solid #dbdbdb;margin:.75em;padding-left:.75em}.menu-label{color:#7a7a7a;font-size:.75em;letter-spacing:.1em;text-transform:uppercase}.menu-label:not(:first-child){margin-top:1em}.menu-label:not(:last-child){margin-bottom:1em}.message{background-color:#f5f5f5;border-radius:4px;font-size:1rem}.message strong{color:currentColor}.message a:not(.button):not(.tag):not(.dropdown-item){color:currentColor;text-decoration:underline}.message.is-small{font-size:.75rem}.message.is-medium{font-size:1.25rem}.message.is-large{font-size:1.5rem}.message.is-white{background-color:#fff}.message.is-white .message-header{background-color:#fff;color:#0a0a0a}.message.is-white .message-body{border-color:#fff}.message.is-black{background-color:#fafafa}.message.is-black .message-header{background-color:#0a0a0a;color:#fff}.message.is-black .message-body{border-color:#0a0a0a}.message.is-light{background-color:#fafafa}.message.is-light .message-header{background-color:#f5f5f5;color:rgba(0,0,0,.7)}.message.is-light .message-body{border-color:#f5f5f5}.message.is-dark{background-color:#fafafa}.message.is-dark .message-header{background-color:#363636;color:#fff}.message.is-dark .message-body{border-color:#363636}.message.is-primary{background-color:#ebfffc}.message.is-primary .message-header{background-color:#00d1b2;color:#fff}.message.is-primary .message-body{border-color:#00d1b2;color:#00947e}.message.is-link{background-color:#eef3fc}.message.is-link .message-header{background-color:#3273dc;color:#fff}.message.is-link .message-body{border-color:#3273dc;color:#2160c4}.message.is-info{background-color:#eef6fc}.message.is-info .message-header{background-color:#3298dc;color:#fff}.message.is-info .message-body{border-color:#3298dc;color:#1d72aa}.message.is-success{background-color:#effaf3}.message.is-success .message-header{background-color:#48c774;color:#fff}.message.is-success .message-body{border-color:#48c774;color:#257942}.message.is-warning{background-color:#fffbeb}.message.is-warning .message-header{background-color:#ffdd57;color:rgba(0,0,0,.7)}.message.is-warning .message-body{border-color:#ffdd57;color:#947600}.message.is-danger{background-color:#feecf0}.message.is-danger .message-header{background-color:#f14668;color:#fff}.message.is-danger .message-body{border-color:#f14668;color:#cc0f35}.message-header{align-items:center;background-color:#4a4a4a;border-radius:4px 4px 0 0;color:#fff;display:flex;font-weight:700;justify-content:space-between;line-height:1.25;padding:.75em 1em;position:relative}.message-header .delete{flex-grow:0;flex-shrink:0;margin-left:.75em}.message-header+.message-body{border-width:0;border-top-left-radius:0;border-top-right-radius:0}.message-body{border-color:#dbdbdb;border-radius:4px;border-style:solid;border-width:0 0 0 4px;color:#4a4a4a;padding:1.25em 1.5em}.message-body code,.message-body pre{background-color:#fff}.message-body pre code{background-color:transparent}.modal{align-items:center;display:none;flex-direction:column;justify-content:center;overflow:hidden;position:fixed;z-index:40}.modal.is-active{display:flex}.modal-background{background-color:rgba(10,10,10,.86)}.modal-card,.modal-content{margin:0 20px;max-height:calc(100vh - 160px);overflow:auto;position:relative;width:100%}@media screen and (min-width:769px),print{.modal-card,.modal-content{margin:0 auto;max-height:calc(100vh - 40px);width:640px}}.modal-close{background:0 0;height:40px;position:fixed;right:20px;top:20px;width:40px}.modal-card{display:flex;flex-direction:column;max-height:calc(100vh - 40px);overflow:hidden;-ms-overflow-y:visible}.modal-card-foot,.modal-card-head{align-items:center;background-color:#f5f5f5;display:flex;flex-shrink:0;justify-content:flex-start;padding:20px;position:relative}.modal-card-head{border-bottom:1px solid #dbdbdb;border-top-left-radius:6px;border-top-right-radius:6px}.modal-card-title{color:#363636;flex-grow:1;flex-shrink:0;font-size:1.5rem;line-height:1}.modal-card-foot{border-bottom-left-radius:6px;border-bottom-right-radius:6px;border-top:1px solid #dbdbdb}.modal-card-foot .button:not(:last-child){margin-right:.5em}.modal-card-body{-webkit-overflow-scrolling:touch;background-color:#fff;flex-grow:1;flex-shrink:1;overflow:auto;padding:20px}.navbar{background-color:#fff;min-height:3.25rem;position:relative;z-index:30}.navbar.is-white{background-color:#fff;color:#0a0a0a}.navbar.is-white .navbar-brand .navbar-link,.navbar.is-white .navbar-brand>.navbar-item{color:#0a0a0a}.navbar.is-white .navbar-brand .navbar-link.is-active,.navbar.is-white .navbar-brand .navbar-link:focus,.navbar.is-white .navbar-brand .navbar-link:hover,.navbar.is-white .navbar-brand>a.navbar-item.is-active,.navbar.is-white .navbar-brand>a.navbar-item:focus,.navbar.is-white .navbar-brand>a.navbar-item:hover{background-color:#f2f2f2;color:#0a0a0a}.navbar.is-white .navbar-brand .navbar-link::after{border-color:#0a0a0a}.navbar.is-white .navbar-burger{color:#0a0a0a}@media screen and (min-width:1024px){.navbar.is-white .navbar-end .navbar-link,.navbar.is-white .navbar-end>.navbar-item,.navbar.is-white .navbar-start .navbar-link,.navbar.is-white .navbar-start>.navbar-item{color:#0a0a0a}.navbar.is-white .navbar-end .navbar-link.is-active,.navbar.is-white .navbar-end .navbar-link:focus,.navbar.is-white .navbar-end .navbar-link:hover,.navbar.is-white .navbar-end>a.navbar-item.is-active,.navbar.is-white .navbar-end>a.navbar-item:focus,.navbar.is-white .navbar-end>a.navbar-item:hover,.navbar.is-white .navbar-start .navbar-link.is-active,.navbar.is-white .navbar-start .navbar-link:focus,.navbar.is-white .navbar-start .navbar-link:hover,.navbar.is-white .navbar-start>a.navbar-item.is-active,.navbar.is-white .navbar-start>a.navbar-item:focus,.navbar.is-white .navbar-start>a.navbar-item:hover{background-color:#f2f2f2;color:#0a0a0a}.navbar.is-white .navbar-end .navbar-link::after,.navbar.is-white .navbar-start .navbar-link::after{border-color:#0a0a0a}.navbar.is-white .navbar-item.has-dropdown.is-active .navbar-link,.navbar.is-white .navbar-item.has-dropdown:focus .navbar-link,.navbar.is-white .navbar-item.has-dropdown:hover .navbar-link{background-color:#f2f2f2;color:#0a0a0a}.navbar.is-white .navbar-dropdown a.navbar-item.is-active{background-color:#fff;color:#0a0a0a}}.navbar.is-black{background-color:#0a0a0a;color:#fff}.navbar.is-black .navbar-brand .navbar-link,.navbar.is-black .navbar-brand>.navbar-item{color:#fff}.navbar.is-black .navbar-brand .navbar-link.is-active,.navbar.is-black .navbar-brand .navbar-link:focus,.navbar.is-black .navbar-brand .navbar-link:hover,.navbar.is-black .navbar-brand>a.navbar-item.is-active,.navbar.is-black .navbar-brand>a.navbar-item:focus,.navbar.is-black .navbar-brand>a.navbar-item:hover{background-color:#000;color:#fff}.navbar.is-black .navbar-brand .navbar-link::after{border-color:#fff}.navbar.is-black .navbar-burger{color:#fff}@media screen and (min-width:1024px){.navbar.is-black .navbar-end .navbar-link,.navbar.is-black .navbar-end>.navbar-item,.navbar.is-black .navbar-start .navbar-link,.navbar.is-black .navbar-start>.navbar-item{color:#fff}.navbar.is-black .navbar-end .navbar-link.is-active,.navbar.is-black .navbar-end .navbar-link:focus,.navbar.is-black .navbar-end .navbar-link:hover,.navbar.is-black .navbar-end>a.navbar-item.is-active,.navbar.is-black .navbar-end>a.navbar-item:focus,.navbar.is-black .navbar-end>a.navbar-item:hover,.navbar.is-black .navbar-start .navbar-link.is-active,.navbar.is-black .navbar-start .navbar-link:focus,.navbar.is-black .navbar-start .navbar-link:hover,.navbar.is-black .navbar-start>a.navbar-item.is-active,.navbar.is-black .navbar-start>a.navbar-item:focus,.navbar.is-black .navbar-start>a.navbar-item:hover{background-color:#000;color:#fff}.navbar.is-black .navbar-end .navbar-link::after,.navbar.is-black .navbar-start .navbar-link::after{border-color:#fff}.navbar.is-black .navbar-item.has-dropdown.is-active .navbar-link,.navbar.is-black .navbar-item.has-dropdown:focus .navbar-link,.navbar.is-black .navbar-item.has-dropdown:hover .navbar-link{background-color:#000;color:#fff}.navbar.is-black .navbar-dropdown a.navbar-item.is-active{background-color:#0a0a0a;color:#fff}}.navbar.is-light{background-color:#f5f5f5;color:rgba(0,0,0,.7)}.navbar.is-light .navbar-brand .navbar-link,.navbar.is-light .navbar-brand>.navbar-item{color:rgba(0,0,0,.7)}.navbar.is-light .navbar-brand .navbar-link.is-active,.navbar.is-light .navbar-brand .navbar-link:focus,.navbar.is-light .navbar-brand .navbar-link:hover,.navbar.is-light .navbar-brand>a.navbar-item.is-active,.navbar.is-light .navbar-brand>a.navbar-item:focus,.navbar.is-light .navbar-brand>a.navbar-item:hover{background-color:#e8e8e8;color:rgba(0,0,0,.7)}.navbar.is-light .navbar-brand .navbar-link::after{border-color:rgba(0,0,0,.7)}.navbar.is-light .navbar-burger{color:rgba(0,0,0,.7)}@media screen and (min-width:1024px){.navbar.is-light .navbar-end .navbar-link,.navbar.is-light .navbar-end>.navbar-item,.navbar.is-light .navbar-start .navbar-link,.navbar.is-light .navbar-start>.navbar-item{color:rgba(0,0,0,.7)}.navbar.is-light .navbar-end .navbar-link.is-active,.navbar.is-light .navbar-end .navbar-link:focus,.navbar.is-light .navbar-end .navbar-link:hover,.navbar.is-light .navbar-end>a.navbar-item.is-active,.navbar.is-light .navbar-end>a.navbar-item:focus,.navbar.is-light .navbar-end>a.navbar-item:hover,.navbar.is-light .navbar-start .navbar-link.is-active,.navbar.is-light .navbar-start .navbar-link:focus,.navbar.is-light .navbar-start .navbar-link:hover,.navbar.is-light .navbar-start>a.navbar-item.is-active,.navbar.is-light .navbar-start>a.navbar-item:focus,.navbar.is-light .navbar-start>a.navbar-item:hover{background-color:#e8e8e8;color:rgba(0,0,0,.7)}.navbar.is-light .navbar-end .navbar-link::after,.navbar.is-light .navbar-start .navbar-link::after{border-color:rgba(0,0,0,.7)}.navbar.is-light .navbar-item.has-dropdown.is-active .navbar-link,.navbar.is-light .navbar-item.has-dropdown:focus .navbar-link,.navbar.is-light .navbar-item.has-dropdown:hover .navbar-link{background-color:#e8e8e8;color:rgba(0,0,0,.7)}.navbar.is-light .navbar-dropdown a.navbar-item.is-active{background-color:#f5f5f5;color:rgba(0,0,0,.7)}}.navbar.is-dark{background-color:#363636;color:#fff}.navbar.is-dark .navbar-brand .navbar-link,.navbar.is-dark .navbar-brand>.navbar-item{color:#fff}.navbar.is-dark .navbar-brand .navbar-link.is-active,.navbar.is-dark .navbar-brand .navbar-link:focus,.navbar.is-dark .navbar-brand .navbar-link:hover,.navbar.is-dark .navbar-brand>a.navbar-item.is-active,.navbar.is-dark .navbar-brand>a.navbar-item:focus,.navbar.is-dark .navbar-brand>a.navbar-item:hover{background-color:#292929;color:#fff}.navbar.is-dark .navbar-brand .navbar-link::after{border-color:#fff}.navbar.is-dark .navbar-burger{color:#fff}@media screen and (min-width:1024px){.navbar.is-dark .navbar-end .navbar-link,.navbar.is-dark .navbar-end>.navbar-item,.navbar.is-dark .navbar-start .navbar-link,.navbar.is-dark .navbar-start>.navbar-item{color:#fff}.navbar.is-dark .navbar-end .navbar-link.is-active,.navbar.is-dark .navbar-end .navbar-link:focus,.navbar.is-dark .navbar-end .navbar-link:hover,.navbar.is-dark .navbar-end>a.navbar-item.is-active,.navbar.is-dark .navbar-end>a.navbar-item:focus,.navbar.is-dark .navbar-end>a.navbar-item:hover,.navbar.is-dark .navbar-start .navbar-link.is-active,.navbar.is-dark .navbar-start .navbar-link:focus,.navbar.is-dark .navbar-start .navbar-link:hover,.navbar.is-dark .navbar-start>a.navbar-item.is-active,.navbar.is-dark .navbar-start>a.navbar-item:focus,.navbar.is-dark .navbar-start>a.navbar-item:hover{background-color:#292929;color:#fff}.navbar.is-dark .navbar-end .navbar-link::after,.navbar.is-dark .navbar-start .navbar-link::after{border-color:#fff}.navbar.is-dark .navbar-item.has-dropdown.is-active .navbar-link,.navbar.is-dark .navbar-item.has-dropdown:focus .navbar-link,.navbar.is-dark .navbar-item.has-dropdown:hover .navbar-link{background-color:#292929;color:#fff}.navbar.is-dark .navbar-dropdown a.navbar-item.is-active{background-color:#363636;color:#fff}}.navbar.is-primary{background-color:#00d1b2;color:#fff}.navbar.is-primary .navbar-brand .navbar-link,.navbar.is-primary .navbar-brand>.navbar-item{color:#fff}.navbar.is-primary .navbar-brand .navbar-link.is-active,.navbar.is-primary .navbar-brand .navbar-link:focus,.navbar.is-primary .navbar-brand .navbar-link:hover,.navbar.is-primary .navbar-brand>a.navbar-item.is-active,.navbar.is-primary .navbar-brand>a.navbar-item:focus,.navbar.is-primary .navbar-brand>a.navbar-item:hover{background-color:#00b89c;color:#fff}.navbar.is-primary .navbar-brand .navbar-link::after{border-color:#fff}.navbar.is-primary .navbar-burger{color:#fff}@media screen and (min-width:1024px){.navbar.is-primary .navbar-end .navbar-link,.navbar.is-primary .navbar-end>.navbar-item,.navbar.is-primary .navbar-start .navbar-link,.navbar.is-primary .navbar-start>.navbar-item{color:#fff}.navbar.is-primary .navbar-end .navbar-link.is-active,.navbar.is-primary .navbar-end .navbar-link:focus,.navbar.is-primary .navbar-end .navbar-link:hover,.navbar.is-primary .navbar-end>a.navbar-item.is-active,.navbar.is-primary .navbar-end>a.navbar-item:focus,.navbar.is-primary .navbar-end>a.navbar-item:hover,.navbar.is-primary .navbar-start .navbar-link.is-active,.navbar.is-primary .navbar-start .navbar-link:focus,.navbar.is-primary .navbar-start .navbar-link:hover,.navbar.is-primary .navbar-start>a.navbar-item.is-active,.navbar.is-primary .navbar-start>a.navbar-item:focus,.navbar.is-primary .navbar-start>a.navbar-item:hover{background-color:#00b89c;color:#fff}.navbar.is-primary .navbar-end .navbar-link::after,.navbar.is-primary .navbar-start .navbar-link::after{border-color:#fff}.navbar.is-primary .navbar-item.has-dropdown.is-active .navbar-link,.navbar.is-primary .navbar-item.has-dropdown:focus .navbar-link,.navbar.is-primary .navbar-item.has-dropdown:hover .navbar-link{background-color:#00b89c;color:#fff}.navbar.is-primary .navbar-dropdown a.navbar-item.is-active{background-color:#00d1b2;color:#fff}}.navbar.is-link{background-color:#3273dc;color:#fff}.navbar.is-link .navbar-brand .navbar-link,.navbar.is-link .navbar-brand>.navbar-item{color:#fff}.navbar.is-link .navbar-brand .navbar-link.is-active,.navbar.is-link .navbar-brand .navbar-link:focus,.navbar.is-link .navbar-brand .navbar-link:hover,.navbar.is-link .navbar-brand>a.navbar-item.is-active,.navbar.is-link .navbar-brand>a.navbar-item:focus,.navbar.is-link .navbar-brand>a.navbar-item:hover{background-color:#2366d1;color:#fff}.navbar.is-link .navbar-brand .navbar-link::after{border-color:#fff}.navbar.is-link .navbar-burger{color:#fff}@media screen and (min-width:1024px){.navbar.is-link .navbar-end .navbar-link,.navbar.is-link .navbar-end>.navbar-item,.navbar.is-link .navbar-start .navbar-link,.navbar.is-link .navbar-start>.navbar-item{color:#fff}.navbar.is-link .navbar-end .navbar-link.is-active,.navbar.is-link .navbar-end .navbar-link:focus,.navbar.is-link .navbar-end .navbar-link:hover,.navbar.is-link .navbar-end>a.navbar-item.is-active,.navbar.is-link .navbar-end>a.navbar-item:focus,.navbar.is-link .navbar-end>a.navbar-item:hover,.navbar.is-link .navbar-start .navbar-link.is-active,.navbar.is-link .navbar-start .navbar-link:focus,.navbar.is-link .navbar-start .navbar-link:hover,.navbar.is-link .navbar-start>a.navbar-item.is-active,.navbar.is-link .navbar-start>a.navbar-item:focus,.navbar.is-link .navbar-start>a.navbar-item:hover{background-color:#2366d1;color:#fff}.navbar.is-link .navbar-end .navbar-link::after,.navbar.is-link .navbar-start .navbar-link::after{border-color:#fff}.navbar.is-link .navbar-item.has-dropdown.is-active .navbar-link,.navbar.is-link .navbar-item.has-dropdown:focus .navbar-link,.navbar.is-link .navbar-item.has-dropdown:hover .navbar-link{background-color:#2366d1;color:#fff}.navbar.is-link .navbar-dropdown a.navbar-item.is-active{background-color:#3273dc;color:#fff}}.navbar.is-info{background-color:#3298dc;color:#fff}.navbar.is-info .navbar-brand .navbar-link,.navbar.is-info .navbar-brand>.navbar-item{color:#fff}.navbar.is-info .navbar-brand .navbar-link.is-active,.navbar.is-info .navbar-brand .navbar-link:focus,.navbar.is-info .navbar-brand .navbar-link:hover,.navbar.is-info .navbar-brand>a.navbar-item.is-active,.navbar.is-info .navbar-brand>a.navbar-item:focus,.navbar.is-info .navbar-brand>a.navbar-item:hover{background-color:#238cd1;color:#fff}.navbar.is-info .navbar-brand .navbar-link::after{border-color:#fff}.navbar.is-info .navbar-burger{color:#fff}@media screen and (min-width:1024px){.navbar.is-info .navbar-end .navbar-link,.navbar.is-info .navbar-end>.navbar-item,.navbar.is-info .navbar-start .navbar-link,.navbar.is-info .navbar-start>.navbar-item{color:#fff}.navbar.is-info .navbar-end .navbar-link.is-active,.navbar.is-info .navbar-end .navbar-link:focus,.navbar.is-info .navbar-end .navbar-link:hover,.navbar.is-info .navbar-end>a.navbar-item.is-active,.navbar.is-info .navbar-end>a.navbar-item:focus,.navbar.is-info .navbar-end>a.navbar-item:hover,.navbar.is-info .navbar-start .navbar-link.is-active,.navbar.is-info .navbar-start .navbar-link:focus,.navbar.is-info .navbar-start .navbar-link:hover,.navbar.is-info .navbar-start>a.navbar-item.is-active,.navbar.is-info .navbar-start>a.navbar-item:focus,.navbar.is-info .navbar-start>a.navbar-item:hover{background-color:#238cd1;color:#fff}.navbar.is-info .navbar-end .navbar-link::after,.navbar.is-info .navbar-start .navbar-link::after{border-color:#fff}.navbar.is-info .navbar-item.has-dropdown.is-active .navbar-link,.navbar.is-info .navbar-item.has-dropdown:focus .navbar-link,.navbar.is-info .navbar-item.has-dropdown:hover .navbar-link{background-color:#238cd1;color:#fff}.navbar.is-info .navbar-dropdown a.navbar-item.is-active{background-color:#3298dc;color:#fff}}.navbar.is-success{background-color:#48c774;color:#fff}.navbar.is-success .navbar-brand .navbar-link,.navbar.is-success .navbar-brand>.navbar-item{color:#fff}.navbar.is-success .navbar-brand .navbar-link.is-active,.navbar.is-success .navbar-brand .navbar-link:focus,.navbar.is-success .navbar-brand .navbar-link:hover,.navbar.is-success .navbar-brand>a.navbar-item.is-active,.navbar.is-success .navbar-brand>a.navbar-item:focus,.navbar.is-success .navbar-brand>a.navbar-item:hover{background-color:#3abb67;color:#fff}.navbar.is-success .navbar-brand .navbar-link::after{border-color:#fff}.navbar.is-success .navbar-burger{color:#fff}@media screen and (min-width:1024px){.navbar.is-success .navbar-end .navbar-link,.navbar.is-success .navbar-end>.navbar-item,.navbar.is-success .navbar-start .navbar-link,.navbar.is-success .navbar-start>.navbar-item{color:#fff}.navbar.is-success .navbar-end .navbar-link.is-active,.navbar.is-success .navbar-end .navbar-link:focus,.navbar.is-success .navbar-end .navbar-link:hover,.navbar.is-success .navbar-end>a.navbar-item.is-active,.navbar.is-success .navbar-end>a.navbar-item:focus,.navbar.is-success .navbar-end>a.navbar-item:hover,.navbar.is-success .navbar-start .navbar-link.is-active,.navbar.is-success .navbar-start .navbar-link:focus,.navbar.is-success .navbar-start .navbar-link:hover,.navbar.is-success .navbar-start>a.navbar-item.is-active,.navbar.is-success .navbar-start>a.navbar-item:focus,.navbar.is-success .navbar-start>a.navbar-item:hover{background-color:#3abb67;color:#fff}.navbar.is-success .navbar-end .navbar-link::after,.navbar.is-success .navbar-start .navbar-link::after{border-color:#fff}.navbar.is-success .navbar-item.has-dropdown.is-active .navbar-link,.navbar.is-success .navbar-item.has-dropdown:focus .navbar-link,.navbar.is-success .navbar-item.has-dropdown:hover .navbar-link{background-color:#3abb67;color:#fff}.navbar.is-success .navbar-dropdown a.navbar-item.is-active{background-color:#48c774;color:#fff}}.navbar.is-warning{background-color:#ffdd57;color:rgba(0,0,0,.7)}.navbar.is-warning .navbar-brand .navbar-link,.navbar.is-warning .navbar-brand>.navbar-item{color:rgba(0,0,0,.7)}.navbar.is-warning .navbar-brand .navbar-link.is-active,.navbar.is-warning .navbar-brand .navbar-link:focus,.navbar.is-warning .navbar-brand .navbar-link:hover,.navbar.is-warning .navbar-brand>a.navbar-item.is-active,.navbar.is-warning .navbar-brand>a.navbar-item:focus,.navbar.is-warning .navbar-brand>a.navbar-item:hover{background-color:#ffd83d;color:rgba(0,0,0,.7)}.navbar.is-warning .navbar-brand .navbar-link::after{border-color:rgba(0,0,0,.7)}.navbar.is-warning .navbar-burger{color:rgba(0,0,0,.7)}@media screen and (min-width:1024px){.navbar.is-warning .navbar-end .navbar-link,.navbar.is-warning .navbar-end>.navbar-item,.navbar.is-warning .navbar-start .navbar-link,.navbar.is-warning .navbar-start>.navbar-item{color:rgba(0,0,0,.7)}.navbar.is-warning .navbar-end .navbar-link.is-active,.navbar.is-warning .navbar-end .navbar-link:focus,.navbar.is-warning .navbar-end .navbar-link:hover,.navbar.is-warning .navbar-end>a.navbar-item.is-active,.navbar.is-warning .navbar-end>a.navbar-item:focus,.navbar.is-warning .navbar-end>a.navbar-item:hover,.navbar.is-warning .navbar-start .navbar-link.is-active,.navbar.is-warning .navbar-start .navbar-link:focus,.navbar.is-warning .navbar-start .navbar-link:hover,.navbar.is-warning .navbar-start>a.navbar-item.is-active,.navbar.is-warning .navbar-start>a.navbar-item:focus,.navbar.is-warning .navbar-start>a.navbar-item:hover{background-color:#ffd83d;color:rgba(0,0,0,.7)}.navbar.is-warning .navbar-end .navbar-link::after,.navbar.is-warning .navbar-start .navbar-link::after{border-color:rgba(0,0,0,.7)}.navbar.is-warning .navbar-item.has-dropdown.is-active .navbar-link,.navbar.is-warning .navbar-item.has-dropdown:focus .navbar-link,.navbar.is-warning .navbar-item.has-dropdown:hover .navbar-link{background-color:#ffd83d;color:rgba(0,0,0,.7)}.navbar.is-warning .navbar-dropdown a.navbar-item.is-active{background-color:#ffdd57;color:rgba(0,0,0,.7)}}.navbar.is-danger{background-color:#f14668;color:#fff}.navbar.is-danger .navbar-brand .navbar-link,.navbar.is-danger .navbar-brand>.navbar-item{color:#fff}.navbar.is-danger .navbar-brand .navbar-link.is-active,.navbar.is-danger .navbar-brand .navbar-link:focus,.navbar.is-danger .navbar-brand .navbar-link:hover,.navbar.is-danger .navbar-brand>a.navbar-item.is-active,.navbar.is-danger .navbar-brand>a.navbar-item:focus,.navbar.is-danger .navbar-brand>a.navbar-item:hover{background-color:#ef2e55;color:#fff}.navbar.is-danger .navbar-brand .navbar-link::after{border-color:#fff}.navbar.is-danger .navbar-burger{color:#fff}@media screen and (min-width:1024px){.navbar.is-danger .navbar-end .navbar-link,.navbar.is-danger .navbar-end>.navbar-item,.navbar.is-danger .navbar-start .navbar-link,.navbar.is-danger .navbar-start>.navbar-item{color:#fff}.navbar.is-danger .navbar-end .navbar-link.is-active,.navbar.is-danger .navbar-end .navbar-link:focus,.navbar.is-danger .navbar-end .navbar-link:hover,.navbar.is-danger .navbar-end>a.navbar-item.is-active,.navbar.is-danger .navbar-end>a.navbar-item:focus,.navbar.is-danger .navbar-end>a.navbar-item:hover,.navbar.is-danger .navbar-start .navbar-link.is-active,.navbar.is-danger .navbar-start .navbar-link:focus,.navbar.is-danger .navbar-start .navbar-link:hover,.navbar.is-danger .navbar-start>a.navbar-item.is-active,.navbar.is-danger .navbar-start>a.navbar-item:focus,.navbar.is-danger .navbar-start>a.navbar-item:hover{background-color:#ef2e55;color:#fff}.navbar.is-danger .navbar-end .navbar-link::after,.navbar.is-danger .navbar-start .navbar-link::after{border-color:#fff}.navbar.is-danger .navbar-item.has-dropdown.is-active .navbar-link,.navbar.is-danger .navbar-item.has-dropdown:focus .navbar-link,.navbar.is-danger .navbar-item.has-dropdown:hover .navbar-link{background-color:#ef2e55;color:#fff}.navbar.is-danger .navbar-dropdown a.navbar-item.is-active{background-color:#f14668;color:#fff}}.navbar>.container{align-items:stretch;display:flex;min-height:3.25rem;width:100%}.navbar.has-shadow{box-shadow:0 2px 0 0 #f5f5f5}.navbar.is-fixed-bottom,.navbar.is-fixed-top{left:0;position:fixed;right:0;z-index:30}.navbar.is-fixed-bottom{bottom:0}.navbar.is-fixed-bottom.has-shadow{box-shadow:0 -2px 0 0 #f5f5f5}.navbar.is-fixed-top{top:0}body.has-navbar-fixed-top,html.has-navbar-fixed-top{padding-top:3.25rem}body.has-navbar-fixed-bottom,html.has-navbar-fixed-bottom{padding-bottom:3.25rem}.navbar-brand,.navbar-tabs{align-items:stretch;display:flex;flex-shrink:0;min-height:3.25rem}.navbar-brand a.navbar-item:focus,.navbar-brand a.navbar-item:hover{background-color:transparent}.navbar-tabs{-webkit-overflow-scrolling:touch;max-width:100vw;overflow-x:auto;overflow-y:hidden}.navbar-burger{color:#4a4a4a;cursor:pointer;display:block;height:3.25rem;position:relative;width:3.25rem;margin-left:auto}.navbar-burger span{background-color:currentColor;display:block;height:1px;left:calc(50% - 8px);position:absolute;transform-origin:center;transition-duration:86ms;transition-property:background-color,opacity,transform;transition-timing-function:ease-out;width:16px}.navbar-burger span:nth-child(1){top:calc(50% - 6px)}.navbar-burger span:nth-child(2){top:calc(50% - 1px)}.navbar-burger span:nth-child(3){top:calc(50% + 4px)}.navbar-burger:hover{background-color:rgba(0,0,0,.05)}.navbar-burger.is-active span:nth-child(1){transform:translateY(5px) rotate(45deg)}.navbar-burger.is-active span:nth-child(2){opacity:0}.navbar-burger.is-active span:nth-child(3){transform:translateY(-5px) rotate(-45deg)}.navbar-menu{display:none}.navbar-item,.navbar-link{color:#4a4a4a;display:block;line-height:1.5;padding:.5rem .75rem;position:relative}.navbar-item .icon:only-child,.navbar-link .icon:only-child{margin-left:-.25rem;margin-right:-.25rem}.navbar-link,a.navbar-item{cursor:pointer}.navbar-link.is-active,.navbar-link:focus,.navbar-link:focus-within,.navbar-link:hover,a.navbar-item.is-active,a.navbar-item:focus,a.navbar-item:focus-within,a.navbar-item:hover{background-color:#fafafa;color:#3273dc}.navbar-item{display:block;flex-grow:0;flex-shrink:0}.navbar-item img{max-height:1.75rem}.navbar-item.has-dropdown{padding:0}.navbar-item.is-expanded{flex-grow:1;flex-shrink:1}.navbar-item.is-tab{border-bottom:1px solid transparent;min-height:3.25rem;padding-bottom:calc(.5rem - 1px)}.navbar-item.is-tab:focus,.navbar-item.is-tab:hover{background-color:transparent;border-bottom-color:#3273dc}.navbar-item.is-tab.is-active{background-color:transparent;border-bottom-color:#3273dc;border-bottom-style:solid;border-bottom-width:3px;color:#3273dc;padding-bottom:calc(.5rem - 3px)}.navbar-content{flex-grow:1;flex-shrink:1}.navbar-link:not(.is-arrowless){padding-right:2.5em}.navbar-link:not(.is-arrowless)::after{border-color:#3273dc;margin-top:-.375em;right:1.125em}.navbar-dropdown{font-size:.875rem;padding-bottom:.5rem;padding-top:.5rem}.navbar-dropdown .navbar-item{padding-left:1.5rem;padding-right:1.5rem}.navbar-divider{background-color:#f5f5f5;border:none;display:none;height:2px;margin:.5rem 0}@media screen and (max-width:1023px){.navbar>.container{display:block}.navbar-brand .navbar-item,.navbar-tabs .navbar-item{align-items:center;display:flex}.navbar-link::after{display:none}.navbar-menu{background-color:#fff;box-shadow:0 8px 16px rgba(10,10,10,.1);padding:.5rem 0}.navbar-menu.is-active{display:block}.navbar.is-fixed-bottom-touch,.navbar.is-fixed-top-touch{left:0;position:fixed;right:0;z-index:30}.navbar.is-fixed-bottom-touch{bottom:0}.navbar.is-fixed-bottom-touch.has-shadow{box-shadow:0 -2px 3px rgba(10,10,10,.1)}.navbar.is-fixed-top-touch{top:0}.navbar.is-fixed-top .navbar-menu,.navbar.is-fixed-top-touch .navbar-menu{-webkit-overflow-scrolling:touch;max-height:calc(100vh - 3.25rem);overflow:auto}body.has-navbar-fixed-top-touch,html.has-navbar-fixed-top-touch{padding-top:3.25rem}body.has-navbar-fixed-bottom-touch,html.has-navbar-fixed-bottom-touch{padding-bottom:3.25rem}}@media screen and (min-width:1024px){.navbar,.navbar-end,.navbar-menu,.navbar-start{align-items:stretch;display:flex}.navbar{min-height:3.25rem}.navbar.is-spaced{padding:1rem 2rem}.navbar.is-spaced .navbar-end,.navbar.is-spaced .navbar-start{align-items:center}.navbar.is-spaced .navbar-link,.navbar.is-spaced a.navbar-item{border-radius:4px}.navbar.is-transparent .navbar-link.is-active,.navbar.is-transparent .navbar-link:focus,.navbar.is-transparent .navbar-link:hover,.navbar.is-transparent a.navbar-item.is-active,.navbar.is-transparent a.navbar-item:focus,.navbar.is-transparent a.navbar-item:hover{background-color:transparent!important}.navbar.is-transparent .navbar-item.has-dropdown.is-active .navbar-link,.navbar.is-transparent .navbar-item.has-dropdown.is-hoverable:focus .navbar-link,.navbar.is-transparent .navbar-item.has-dropdown.is-hoverable:focus-within .navbar-link,.navbar.is-transparent .navbar-item.has-dropdown.is-hoverable:hover .navbar-link{background-color:transparent!important}.navbar.is-transparent .navbar-dropdown a.navbar-item:focus,.navbar.is-transparent .navbar-dropdown a.navbar-item:hover{background-color:#f5f5f5;color:#0a0a0a}.navbar.is-transparent .navbar-dropdown a.navbar-item.is-active{background-color:#f5f5f5;color:#3273dc}.navbar-burger{display:none}.navbar-item,.navbar-link{align-items:center;display:flex}.navbar-item{display:flex}.navbar-item.has-dropdown{align-items:stretch}.navbar-item.has-dropdown-up .navbar-link::after{transform:rotate(135deg) translate(.25em,-.25em)}.navbar-item.has-dropdown-up .navbar-dropdown{border-bottom:2px solid #dbdbdb;border-radius:6px 6px 0 0;border-top:none;bottom:100%;box-shadow:0 -8px 8px rgba(10,10,10,.1);top:auto}.navbar-item.is-active .navbar-dropdown,.navbar-item.is-hoverable:focus .navbar-dropdown,.navbar-item.is-hoverable:focus-within .navbar-dropdown,.navbar-item.is-hoverable:hover .navbar-dropdown{display:block}.navbar-item.is-active .navbar-dropdown.is-boxed,.navbar-item.is-hoverable:focus .navbar-dropdown.is-boxed,.navbar-item.is-hoverable:focus-within .navbar-dropdown.is-boxed,.navbar-item.is-hoverable:hover .navbar-dropdown.is-boxed,.navbar.is-spaced .navbar-item.is-active .navbar-dropdown,.navbar.is-spaced .navbar-item.is-hoverable:focus .navbar-dropdown,.navbar.is-spaced .navbar-item.is-hoverable:focus-within .navbar-dropdown,.navbar.is-spaced .navbar-item.is-hoverable:hover .navbar-dropdown{opacity:1;pointer-events:auto;transform:translateY(0)}.navbar-menu{flex-grow:1;flex-shrink:0}.navbar-start{justify-content:flex-start;margin-right:auto}.navbar-end{justify-content:flex-end;margin-left:auto}.navbar-dropdown{background-color:#fff;border-bottom-left-radius:6px;border-bottom-right-radius:6px;border-top:2px solid #dbdbdb;box-shadow:0 8px 8px rgba(10,10,10,.1);display:none;font-size:.875rem;left:0;min-width:100%;position:absolute;top:100%;z-index:20}.navbar-dropdown .navbar-item{padding:.375rem 1rem;white-space:nowrap}.navbar-dropdown a.navbar-item{padding-right:3rem}.navbar-dropdown a.navbar-item:focus,.navbar-dropdown a.navbar-item:hover{background-color:#f5f5f5;color:#0a0a0a}.navbar-dropdown a.navbar-item.is-active{background-color:#f5f5f5;color:#3273dc}.navbar-dropdown.is-boxed,.navbar.is-spaced .navbar-dropdown{border-radius:6px;border-top:none;box-shadow:0 8px 8px rgba(10,10,10,.1),0 0 0 1px rgba(10,10,10,.1);display:block;opacity:0;pointer-events:none;top:calc(100% + (-4px));transform:translateY(-5px);transition-duration:86ms;transition-property:opacity,transform}.navbar-dropdown.is-right{left:auto;right:0}.navbar-divider{display:block}.container>.navbar .navbar-brand,.navbar>.container .navbar-brand{margin-left:-.75rem}.container>.navbar .navbar-menu,.navbar>.container .navbar-menu{margin-right:-.75rem}.navbar.is-fixed-bottom-desktop,.navbar.is-fixed-top-desktop{left:0;position:fixed;right:0;z-index:30}.navbar.is-fixed-bottom-desktop{bottom:0}.navbar.is-fixed-bottom-desktop.has-shadow{box-shadow:0 -2px 3px rgba(10,10,10,.1)}.navbar.is-fixed-top-desktop{top:0}body.has-navbar-fixed-top-desktop,html.has-navbar-fixed-top-desktop{padding-top:3.25rem}body.has-navbar-fixed-bottom-desktop,html.has-navbar-fixed-bottom-desktop{padding-bottom:3.25rem}body.has-spaced-navbar-fixed-top,html.has-spaced-navbar-fixed-top{padding-top:5.25rem}body.has-spaced-navbar-fixed-bottom,html.has-spaced-navbar-fixed-bottom{padding-bottom:5.25rem}.navbar-link.is-active,a.navbar-item.is-active{color:#0a0a0a}.navbar-link.is-active:not(:focus):not(:hover),a.navbar-item.is-active:not(:focus):not(:hover){background-color:transparent}.navbar-item.has-dropdown.is-active .navbar-link,.navbar-item.has-dropdown:focus .navbar-link,.navbar-item.has-dropdown:hover .navbar-link{background-color:#fafafa}}.hero.is-fullheight-with-navbar{min-height:calc(100vh - 3.25rem)}.pagination{font-size:1rem;margin:-.25rem}.pagination.is-small{font-size:.75rem}.pagination.is-medium{font-size:1.25rem}.pagination.is-large{font-size:1.5rem}.pagination.is-rounded .pagination-next,.pagination.is-rounded .pagination-previous{padding-left:1em;padding-right:1em;border-radius:290486px}.pagination.is-rounded .pagination-link{border-radius:290486px}.pagination,.pagination-list{align-items:center;display:flex;justify-content:center;text-align:center}.pagination-ellipsis,.pagination-link,.pagination-next,.pagination-previous{font-size:1em;justify-content:center;margin:.25rem;padding-left:.5em;padding-right:.5em;text-align:center}.pagination-link,.pagination-next,.pagination-previous{border-color:#dbdbdb;color:#363636;min-width:2.5em}.pagination-link:hover,.pagination-next:hover,.pagination-previous:hover{border-color:#b5b5b5;color:#363636}.pagination-link:focus,.pagination-next:focus,.pagination-previous:focus{border-color:#3273dc}.pagination-link:active,.pagination-next:active,.pagination-previous:active{box-shadow:inset 0 1px 2px rgba(10,10,10,.2)}.pagination-link[disabled],.pagination-next[disabled],.pagination-previous[disabled]{background-color:#dbdbdb;border-color:#dbdbdb;box-shadow:none;color:#7a7a7a;opacity:.5}.pagination-next,.pagination-previous{padding-left:.75em;padding-right:.75em;white-space:nowrap}.pagination-link.is-current{background-color:#3273dc;border-color:#3273dc;color:#fff}.pagination-ellipsis{color:#b5b5b5;pointer-events:none}.pagination-list{flex-wrap:wrap}@media screen and (max-width:768px){.pagination{flex-wrap:wrap}.pagination-next,.pagination-previous{flex-grow:1;flex-shrink:1}.pagination-list li{flex-grow:1;flex-shrink:1}}@media screen and (min-width:769px),print{.pagination-list{flex-grow:1;flex-shrink:1;justify-content:flex-start;order:1}.pagination-previous{order:2}.pagination-next{order:3}.pagination{justify-content:space-between}.pagination.is-centered .pagination-previous{order:1}.pagination.is-centered .pagination-list{justify-content:center;order:2}.pagination.is-centered .pagination-next{order:3}.pagination.is-right .pagination-previous{order:1}.pagination.is-right .pagination-next{order:2}.pagination.is-right .pagination-list{justify-content:flex-end;order:3}}.panel{border-radius:6px;box-shadow:0 .5em 1em -.125em rgba(10,10,10,.1),0 0 0 1px rgba(10,10,10,.02);font-size:1rem}.panel:not(:last-child){margin-bottom:1.5rem}.panel.is-white .panel-heading{background-color:#fff;color:#0a0a0a}.panel.is-white .panel-tabs a.is-active{border-bottom-color:#fff}.panel.is-white .panel-block.is-active .panel-icon{color:#fff}.panel.is-black .panel-heading{background-color:#0a0a0a;color:#fff}.panel.is-black .panel-tabs a.is-active{border-bottom-color:#0a0a0a}.panel.is-black .panel-block.is-active .panel-icon{color:#0a0a0a}.panel.is-light .panel-heading{background-color:#f5f5f5;color:rgba(0,0,0,.7)}.panel.is-light .panel-tabs a.is-active{border-bottom-color:#f5f5f5}.panel.is-light .panel-block.is-active .panel-icon{color:#f5f5f5}.panel.is-dark .panel-heading{background-color:#363636;color:#fff}.panel.is-dark .panel-tabs a.is-active{border-bottom-color:#363636}.panel.is-dark .panel-block.is-active .panel-icon{color:#363636}.panel.is-primary .panel-heading{background-color:#00d1b2;color:#fff}.panel.is-primary .panel-tabs a.is-active{border-bottom-color:#00d1b2}.panel.is-primary .panel-block.is-active .panel-icon{color:#00d1b2}.panel.is-link .panel-heading{background-color:#3273dc;color:#fff}.panel.is-link .panel-tabs a.is-active{border-bottom-color:#3273dc}.panel.is-link .panel-block.is-active .panel-icon{color:#3273dc}.panel.is-info .panel-heading{background-color:#3298dc;color:#fff}.panel.is-info .panel-tabs a.is-active{border-bottom-color:#3298dc}.panel.is-info .panel-block.is-active .panel-icon{color:#3298dc}.panel.is-success .panel-heading{background-color:#48c774;color:#fff}.panel.is-success .panel-tabs a.is-active{border-bottom-color:#48c774}.panel.is-success .panel-block.is-active .panel-icon{color:#48c774}.panel.is-warning .panel-heading{background-color:#ffdd57;color:rgba(0,0,0,.7)}.panel.is-warning .panel-tabs a.is-active{border-bottom-color:#ffdd57}.panel.is-warning .panel-block.is-active .panel-icon{color:#ffdd57}.panel.is-danger .panel-heading{background-color:#f14668;color:#fff}.panel.is-danger .panel-tabs a.is-active{border-bottom-color:#f14668}.panel.is-danger .panel-block.is-active .panel-icon{color:#f14668}.panel-block:not(:last-child),.panel-tabs:not(:last-child){border-bottom:1px solid #ededed}.panel-heading{background-color:#ededed;border-radius:6px 6px 0 0;color:#363636;font-size:1.25em;font-weight:700;line-height:1.25;padding:.75em 1em}.panel-tabs{align-items:flex-end;display:flex;font-size:.875em;justify-content:center}.panel-tabs a{border-bottom:1px solid #dbdbdb;margin-bottom:-1px;padding:.5em}.panel-tabs a.is-active{border-bottom-color:#4a4a4a;color:#363636}.panel-list a{color:#4a4a4a}.panel-list a:hover{color:#3273dc}.panel-block{align-items:center;color:#363636;display:flex;justify-content:flex-start;padding:.5em .75em}.panel-block input[type=checkbox]{margin-right:.75em}.panel-block>.control{flex-grow:1;flex-shrink:1;width:100%}.panel-block.is-wrapped{flex-wrap:wrap}.panel-block.is-active{border-left-color:#3273dc;color:#363636}.panel-block.is-active .panel-icon{color:#3273dc}.panel-block:last-child{border-bottom-left-radius:6px;border-bottom-right-radius:6px}a.panel-block,label.panel-block{cursor:pointer}a.panel-block:hover,label.panel-block:hover{background-color:#f5f5f5}.panel-icon{display:inline-block;font-size:14px;height:1em;line-height:1em;text-align:center;vertical-align:top;width:1em;color:#7a7a7a;margin-right:.75em}.panel-icon .fa{font-size:inherit;line-height:inherit}.tabs{-webkit-overflow-scrolling:touch;align-items:stretch;display:flex;font-size:1rem;justify-content:space-between;overflow:hidden;overflow-x:auto;white-space:nowrap}.tabs a{align-items:center;border-bottom-color:#dbdbdb;border-bottom-style:solid;border-bottom-width:1px;color:#4a4a4a;display:flex;justify-content:center;margin-bottom:-1px;padding:.5em 1em;vertical-align:top}.tabs a:hover{border-bottom-color:#363636;color:#363636}.tabs li{display:block}.tabs li.is-active a{border-bottom-color:#3273dc;color:#3273dc}.tabs ul{align-items:center;border-bottom-color:#dbdbdb;border-bottom-style:solid;border-bottom-width:1px;display:flex;flex-grow:1;flex-shrink:0;justify-content:flex-start}.tabs ul.is-left{padding-right:.75em}.tabs ul.is-center{flex:none;justify-content:center;padding-left:.75em;padding-right:.75em}.tabs ul.is-right{justify-content:flex-end;padding-left:.75em}.tabs .icon:first-child{margin-right:.5em}.tabs .icon:last-child{margin-left:.5em}.tabs.is-centered ul{justify-content:center}.tabs.is-right ul{justify-content:flex-end}.tabs.is-boxed a{border:1px solid transparent;border-radius:4px 4px 0 0}.tabs.is-boxed a:hover{background-color:#f5f5f5;border-bottom-color:#dbdbdb}.tabs.is-boxed li.is-active a{background-color:#fff;border-color:#dbdbdb;border-bottom-color:transparent!important}.tabs.is-fullwidth li{flex-grow:1;flex-shrink:0}.tabs.is-toggle a{border-color:#dbdbdb;border-style:solid;border-width:1px;margin-bottom:0;position:relative}.tabs.is-toggle a:hover{background-color:#f5f5f5;border-color:#b5b5b5;z-index:2}.tabs.is-toggle li+li{margin-left:-1px}.tabs.is-toggle li:first-child a{border-radius:4px 0 0 4px}.tabs.is-toggle li:last-child a{border-radius:0 4px 4px 0}.tabs.is-toggle li.is-active a{background-color:#3273dc;border-color:#3273dc;color:#fff;z-index:1}.tabs.is-toggle ul{border-bottom:none}.tabs.is-toggle.is-toggle-rounded li:first-child a{border-bottom-left-radius:290486px;border-top-left-radius:290486px;padding-left:1.25em}.tabs.is-toggle.is-toggle-rounded li:last-child a{border-bottom-right-radius:290486px;border-top-right-radius:290486px;padding-right:1.25em}.tabs.is-small{font-size:.75rem}.tabs.is-medium{font-size:1.25rem}.tabs.is-large{font-size:1.5rem}.column{display:block;flex-basis:0;flex-grow:1;flex-shrink:1;padding:.75rem}.columns.is-mobile>.column.is-narrow{flex:none}.columns.is-mobile>.column.is-full{flex:none;width:100%}.columns.is-mobile>.column.is-three-quarters{flex:none;width:75%}.columns.is-mobile>.column.is-two-thirds{flex:none;width:66.6666%}.columns.is-mobile>.column.is-half{flex:none;width:50%}.columns.is-mobile>.column.is-one-third{flex:none;width:33.3333%}.columns.is-mobile>.column.is-one-quarter{flex:none;width:25%}.columns.is-mobile>.column.is-one-fifth{flex:none;width:20%}.columns.is-mobile>.column.is-two-fifths{flex:none;width:40%}.columns.is-mobile>.column.is-three-fifths{flex:none;width:60%}.columns.is-mobile>.column.is-four-fifths{flex:none;width:80%}.columns.is-mobile>.column.is-offset-three-quarters{margin-left:75%}.columns.is-mobile>.column.is-offset-two-thirds{margin-left:66.6666%}.columns.is-mobile>.column.is-offset-half{margin-left:50%}.columns.is-mobile>.column.is-offset-one-third{margin-left:33.3333%}.columns.is-mobile>.column.is-offset-one-quarter{margin-left:25%}.columns.is-mobile>.column.is-offset-one-fifth{margin-left:20%}.columns.is-mobile>.column.is-offset-two-fifths{margin-left:40%}.columns.is-mobile>.column.is-offset-three-fifths{margin-left:60%}.columns.is-mobile>.column.is-offset-four-fifths{margin-left:80%}.columns.is-mobile>.column.is-0{flex:none;width:0%}.columns.is-mobile>.column.is-offset-0{margin-left:0}.columns.is-mobile>.column.is-1{flex:none;width:8.33333%}.columns.is-mobile>.column.is-offset-1{margin-left:8.33333%}.columns.is-mobile>.column.is-2{flex:none;width:16.66667%}.columns.is-mobile>.column.is-offset-2{margin-left:16.66667%}.columns.is-mobile>.column.is-3{flex:none;width:25%}.columns.is-mobile>.column.is-offset-3{margin-left:25%}.columns.is-mobile>.column.is-4{flex:none;width:33.33333%}.columns.is-mobile>.column.is-offset-4{margin-left:33.33333%}.columns.is-mobile>.column.is-5{flex:none;width:41.66667%}.columns.is-mobile>.column.is-offset-5{margin-left:41.66667%}.columns.is-mobile>.column.is-6{flex:none;width:50%}.columns.is-mobile>.column.is-offset-6{margin-left:50%}.columns.is-mobile>.column.is-7{flex:none;width:58.33333%}.columns.is-mobile>.column.is-offset-7{margin-left:58.33333%}.columns.is-mobile>.column.is-8{flex:none;width:66.66667%}.columns.is-mobile>.column.is-offset-8{margin-left:66.66667%}.columns.is-mobile>.column.is-9{flex:none;width:75%}.columns.is-mobile>.column.is-offset-9{margin-left:75%}.columns.is-mobile>.column.is-10{flex:none;width:83.33333%}.columns.is-mobile>.column.is-offset-10{margin-left:83.33333%}.columns.is-mobile>.column.is-11{flex:none;width:91.66667%}.columns.is-mobile>.column.is-offset-11{margin-left:91.66667%}.columns.is-mobile>.column.is-12{flex:none;width:100%}.columns.is-mobile>.column.is-offset-12{margin-left:100%}@media screen and (max-width:768px){.column.is-narrow-mobile{flex:none}.column.is-full-mobile{flex:none;width:100%}.column.is-three-quarters-mobile{flex:none;width:75%}.column.is-two-thirds-mobile{flex:none;width:66.6666%}.column.is-half-mobile{flex:none;width:50%}.column.is-one-third-mobile{flex:none;width:33.3333%}.column.is-one-quarter-mobile{flex:none;width:25%}.column.is-one-fifth-mobile{flex:none;width:20%}.column.is-two-fifths-mobile{flex:none;width:40%}.column.is-three-fifths-mobile{flex:none;width:60%}.column.is-four-fifths-mobile{flex:none;width:80%}.column.is-offset-three-quarters-mobile{margin-left:75%}.column.is-offset-two-thirds-mobile{margin-left:66.6666%}.column.is-offset-half-mobile{margin-left:50%}.column.is-offset-one-third-mobile{margin-left:33.3333%}.column.is-offset-one-quarter-mobile{margin-left:25%}.column.is-offset-one-fifth-mobile{margin-left:20%}.column.is-offset-two-fifths-mobile{margin-left:40%}.column.is-offset-three-fifths-mobile{margin-left:60%}.column.is-offset-four-fifths-mobile{margin-left:80%}.column.is-0-mobile{flex:none;width:0%}.column.is-offset-0-mobile{margin-left:0}.column.is-1-mobile{flex:none;width:8.33333%}.column.is-offset-1-mobile{margin-left:8.33333%}.column.is-2-mobile{flex:none;width:16.66667%}.column.is-offset-2-mobile{margin-left:16.66667%}.column.is-3-mobile{flex:none;width:25%}.column.is-offset-3-mobile{margin-left:25%}.column.is-4-mobile{flex:none;width:33.33333%}.column.is-offset-4-mobile{margin-left:33.33333%}.column.is-5-mobile{flex:none;width:41.66667%}.column.is-offset-5-mobile{margin-left:41.66667%}.column.is-6-mobile{flex:none;width:50%}.column.is-offset-6-mobile{margin-left:50%}.column.is-7-mobile{flex:none;width:58.33333%}.column.is-offset-7-mobile{margin-left:58.33333%}.column.is-8-mobile{flex:none;width:66.66667%}.column.is-offset-8-mobile{margin-left:66.66667%}.column.is-9-mobile{flex:none;width:75%}.column.is-offset-9-mobile{margin-left:75%}.column.is-10-mobile{flex:none;width:83.33333%}.column.is-offset-10-mobile{margin-left:83.33333%}.column.is-11-mobile{flex:none;width:91.66667%}.column.is-offset-11-mobile{margin-left:91.66667%}.column.is-12-mobile{flex:none;width:100%}.column.is-offset-12-mobile{margin-left:100%}}@media screen and (min-width:769px),print{.column.is-narrow,.column.is-narrow-tablet{flex:none}.column.is-full,.column.is-full-tablet{flex:none;width:100%}.column.is-three-quarters,.column.is-three-quarters-tablet{flex:none;width:75%}.column.is-two-thirds,.column.is-two-thirds-tablet{flex:none;width:66.6666%}.column.is-half,.column.is-half-tablet{flex:none;width:50%}.column.is-one-third,.column.is-one-third-tablet{flex:none;width:33.3333%}.column.is-one-quarter,.column.is-one-quarter-tablet{flex:none;width:25%}.column.is-one-fifth,.column.is-one-fifth-tablet{flex:none;width:20%}.column.is-two-fifths,.column.is-two-fifths-tablet{flex:none;width:40%}.column.is-three-fifths,.column.is-three-fifths-tablet{flex:none;width:60%}.column.is-four-fifths,.column.is-four-fifths-tablet{flex:none;width:80%}.column.is-offset-three-quarters,.column.is-offset-three-quarters-tablet{margin-left:75%}.column.is-offset-two-thirds,.column.is-offset-two-thirds-tablet{margin-left:66.6666%}.column.is-offset-half,.column.is-offset-half-tablet{margin-left:50%}.column.is-offset-one-third,.column.is-offset-one-third-tablet{margin-left:33.3333%}.column.is-offset-one-quarter,.column.is-offset-one-quarter-tablet{margin-left:25%}.column.is-offset-one-fifth,.column.is-offset-one-fifth-tablet{margin-left:20%}.column.is-offset-two-fifths,.column.is-offset-two-fifths-tablet{margin-left:40%}.column.is-offset-three-fifths,.column.is-offset-three-fifths-tablet{margin-left:60%}.column.is-offset-four-fifths,.column.is-offset-four-fifths-tablet{margin-left:80%}.column.is-0,.column.is-0-tablet{flex:none;width:0%}.column.is-offset-0,.column.is-offset-0-tablet{margin-left:0}.column.is-1,.column.is-1-tablet{flex:none;width:8.33333%}.column.is-offset-1,.column.is-offset-1-tablet{margin-left:8.33333%}.column.is-2,.column.is-2-tablet{flex:none;width:16.66667%}.column.is-offset-2,.column.is-offset-2-tablet{margin-left:16.66667%}.column.is-3,.column.is-3-tablet{flex:none;width:25%}.column.is-offset-3,.column.is-offset-3-tablet{margin-left:25%}.column.is-4,.column.is-4-tablet{flex:none;width:33.33333%}.column.is-offset-4,.column.is-offset-4-tablet{margin-left:33.33333%}.column.is-5,.column.is-5-tablet{flex:none;width:41.66667%}.column.is-offset-5,.column.is-offset-5-tablet{margin-left:41.66667%}.column.is-6,.column.is-6-tablet{flex:none;width:50%}.column.is-offset-6,.column.is-offset-6-tablet{margin-left:50%}.column.is-7,.column.is-7-tablet{flex:none;width:58.33333%}.column.is-offset-7,.column.is-offset-7-tablet{margin-left:58.33333%}.column.is-8,.column.is-8-tablet{flex:none;width:66.66667%}.column.is-offset-8,.column.is-offset-8-tablet{margin-left:66.66667%}.column.is-9,.column.is-9-tablet{flex:none;width:75%}.column.is-offset-9,.column.is-offset-9-tablet{margin-left:75%}.column.is-10,.column.is-10-tablet{flex:none;width:83.33333%}.column.is-offset-10,.column.is-offset-10-tablet{margin-left:83.33333%}.column.is-11,.column.is-11-tablet{flex:none;width:91.66667%}.column.is-offset-11,.column.is-offset-11-tablet{margin-left:91.66667%}.column.is-12,.column.is-12-tablet{flex:none;width:100%}.column.is-offset-12,.column.is-offset-12-tablet{margin-left:100%}}@media screen and (max-width:1023px){.column.is-narrow-touch{flex:none}.column.is-full-touch{flex:none;width:100%}.column.is-three-quarters-touch{flex:none;width:75%}.column.is-two-thirds-touch{flex:none;width:66.6666%}.column.is-half-touch{flex:none;width:50%}.column.is-one-third-touch{flex:none;width:33.3333%}.column.is-one-quarter-touch{flex:none;width:25%}.column.is-one-fifth-touch{flex:none;width:20%}.column.is-two-fifths-touch{flex:none;width:40%}.column.is-three-fifths-touch{flex:none;width:60%}.column.is-four-fifths-touch{flex:none;width:80%}.column.is-offset-three-quarters-touch{margin-left:75%}.column.is-offset-two-thirds-touch{margin-left:66.6666%}.column.is-offset-half-touch{margin-left:50%}.column.is-offset-one-third-touch{margin-left:33.3333%}.column.is-offset-one-quarter-touch{margin-left:25%}.column.is-offset-one-fifth-touch{margin-left:20%}.column.is-offset-two-fifths-touch{margin-left:40%}.column.is-offset-three-fifths-touch{margin-left:60%}.column.is-offset-four-fifths-touch{margin-left:80%}.column.is-0-touch{flex:none;width:0%}.column.is-offset-0-touch{margin-left:0}.column.is-1-touch{flex:none;width:8.33333%}.column.is-offset-1-touch{margin-left:8.33333%}.column.is-2-touch{flex:none;width:16.66667%}.column.is-offset-2-touch{margin-left:16.66667%}.column.is-3-touch{flex:none;width:25%}.column.is-offset-3-touch{margin-left:25%}.column.is-4-touch{flex:none;width:33.33333%}.column.is-offset-4-touch{margin-left:33.33333%}.column.is-5-touch{flex:none;width:41.66667%}.column.is-offset-5-touch{margin-left:41.66667%}.column.is-6-touch{flex:none;width:50%}.column.is-offset-6-touch{margin-left:50%}.column.is-7-touch{flex:none;width:58.33333%}.column.is-offset-7-touch{margin-left:58.33333%}.column.is-8-touch{flex:none;width:66.66667%}.column.is-offset-8-touch{margin-left:66.66667%}.column.is-9-touch{flex:none;width:75%}.column.is-offset-9-touch{margin-left:75%}.column.is-10-touch{flex:none;width:83.33333%}.column.is-offset-10-touch{margin-left:83.33333%}.column.is-11-touch{flex:none;width:91.66667%}.column.is-offset-11-touch{margin-left:91.66667%}.column.is-12-touch{flex:none;width:100%}.column.is-offset-12-touch{margin-left:100%}}@media screen and (min-width:1024px){.column.is-narrow-desktop{flex:none}.column.is-full-desktop{flex:none;width:100%}.column.is-three-quarters-desktop{flex:none;width:75%}.column.is-two-thirds-desktop{flex:none;width:66.6666%}.column.is-half-desktop{flex:none;width:50%}.column.is-one-third-desktop{flex:none;width:33.3333%}.column.is-one-quarter-desktop{flex:none;width:25%}.column.is-one-fifth-desktop{flex:none;width:20%}.column.is-two-fifths-desktop{flex:none;width:40%}.column.is-three-fifths-desktop{flex:none;width:60%}.column.is-four-fifths-desktop{flex:none;width:80%}.column.is-offset-three-quarters-desktop{margin-left:75%}.column.is-offset-two-thirds-desktop{margin-left:66.6666%}.column.is-offset-half-desktop{margin-left:50%}.column.is-offset-one-third-desktop{margin-left:33.3333%}.column.is-offset-one-quarter-desktop{margin-left:25%}.column.is-offset-one-fifth-desktop{margin-left:20%}.column.is-offset-two-fifths-desktop{margin-left:40%}.column.is-offset-three-fifths-desktop{margin-left:60%}.column.is-offset-four-fifths-desktop{margin-left:80%}.column.is-0-desktop{flex:none;width:0%}.column.is-offset-0-desktop{margin-left:0}.column.is-1-desktop{flex:none;width:8.33333%}.column.is-offset-1-desktop{margin-left:8.33333%}.column.is-2-desktop{flex:none;width:16.66667%}.column.is-offset-2-desktop{margin-left:16.66667%}.column.is-3-desktop{flex:none;width:25%}.column.is-offset-3-desktop{margin-left:25%}.column.is-4-desktop{flex:none;width:33.33333%}.column.is-offset-4-desktop{margin-left:33.33333%}.column.is-5-desktop{flex:none;width:41.66667%}.column.is-offset-5-desktop{margin-left:41.66667%}.column.is-6-desktop{flex:none;width:50%}.column.is-offset-6-desktop{margin-left:50%}.column.is-7-desktop{flex:none;width:58.33333%}.column.is-offset-7-desktop{margin-left:58.33333%}.column.is-8-desktop{flex:none;width:66.66667%}.column.is-offset-8-desktop{margin-left:66.66667%}.column.is-9-desktop{flex:none;width:75%}.column.is-offset-9-desktop{margin-left:75%}.column.is-10-desktop{flex:none;width:83.33333%}.column.is-offset-10-desktop{margin-left:83.33333%}.column.is-11-desktop{flex:none;width:91.66667%}.column.is-offset-11-desktop{margin-left:91.66667%}.column.is-12-desktop{flex:none;width:100%}.column.is-offset-12-desktop{margin-left:100%}}@media screen and (min-width:1216px){.column.is-narrow-widescreen{flex:none}.column.is-full-widescreen{flex:none;width:100%}.column.is-three-quarters-widescreen{flex:none;width:75%}.column.is-two-thirds-widescreen{flex:none;width:66.6666%}.column.is-half-widescreen{flex:none;width:50%}.column.is-one-third-widescreen{flex:none;width:33.3333%}.column.is-one-quarter-widescreen{flex:none;width:25%}.column.is-one-fifth-widescreen{flex:none;width:20%}.column.is-two-fifths-widescreen{flex:none;width:40%}.column.is-three-fifths-widescreen{flex:none;width:60%}.column.is-four-fifths-widescreen{flex:none;width:80%}.column.is-offset-three-quarters-widescreen{margin-left:75%}.column.is-offset-two-thirds-widescreen{margin-left:66.6666%}.column.is-offset-half-widescreen{margin-left:50%}.column.is-offset-one-third-widescreen{margin-left:33.3333%}.column.is-offset-one-quarter-widescreen{margin-left:25%}.column.is-offset-one-fifth-widescreen{margin-left:20%}.column.is-offset-two-fifths-widescreen{margin-left:40%}.column.is-offset-three-fifths-widescreen{margin-left:60%}.column.is-offset-four-fifths-widescreen{margin-left:80%}.column.is-0-widescreen{flex:none;width:0%}.column.is-offset-0-widescreen{margin-left:0}.column.is-1-widescreen{flex:none;width:8.33333%}.column.is-offset-1-widescreen{margin-left:8.33333%}.column.is-2-widescreen{flex:none;width:16.66667%}.column.is-offset-2-widescreen{margin-left:16.66667%}.column.is-3-widescreen{flex:none;width:25%}.column.is-offset-3-widescreen{margin-left:25%}.column.is-4-widescreen{flex:none;width:33.33333%}.column.is-offset-4-widescreen{margin-left:33.33333%}.column.is-5-widescreen{flex:none;width:41.66667%}.column.is-offset-5-widescreen{margin-left:41.66667%}.column.is-6-widescreen{flex:none;width:50%}.column.is-offset-6-widescreen{margin-left:50%}.column.is-7-widescreen{flex:none;width:58.33333%}.column.is-offset-7-widescreen{margin-left:58.33333%}.column.is-8-widescreen{flex:none;width:66.66667%}.column.is-offset-8-widescreen{margin-left:66.66667%}.column.is-9-widescreen{flex:none;width:75%}.column.is-offset-9-widescreen{margin-left:75%}.column.is-10-widescreen{flex:none;width:83.33333%}.column.is-offset-10-widescreen{margin-left:83.33333%}.column.is-11-widescreen{flex:none;width:91.66667%}.column.is-offset-11-widescreen{margin-left:91.66667%}.column.is-12-widescreen{flex:none;width:100%}.column.is-offset-12-widescreen{margin-left:100%}}@media screen and (min-width:1408px){.column.is-narrow-fullhd{flex:none}.column.is-full-fullhd{flex:none;width:100%}.column.is-three-quarters-fullhd{flex:none;width:75%}.column.is-two-thirds-fullhd{flex:none;width:66.6666%}.column.is-half-fullhd{flex:none;width:50%}.column.is-one-third-fullhd{flex:none;width:33.3333%}.column.is-one-quarter-fullhd{flex:none;width:25%}.column.is-one-fifth-fullhd{flex:none;width:20%}.column.is-two-fifths-fullhd{flex:none;width:40%}.column.is-three-fifths-fullhd{flex:none;width:60%}.column.is-four-fifths-fullhd{flex:none;width:80%}.column.is-offset-three-quarters-fullhd{margin-left:75%}.column.is-offset-two-thirds-fullhd{margin-left:66.6666%}.column.is-offset-half-fullhd{margin-left:50%}.column.is-offset-one-third-fullhd{margin-left:33.3333%}.column.is-offset-one-quarter-fullhd{margin-left:25%}.column.is-offset-one-fifth-fullhd{margin-left:20%}.column.is-offset-two-fifths-fullhd{margin-left:40%}.column.is-offset-three-fifths-fullhd{margin-left:60%}.column.is-offset-four-fifths-fullhd{margin-left:80%}.column.is-0-fullhd{flex:none;width:0%}.column.is-offset-0-fullhd{margin-left:0}.column.is-1-fullhd{flex:none;width:8.33333%}.column.is-offset-1-fullhd{margin-left:8.33333%}.column.is-2-fullhd{flex:none;width:16.66667%}.column.is-offset-2-fullhd{margin-left:16.66667%}.column.is-3-fullhd{flex:none;width:25%}.column.is-offset-3-fullhd{margin-left:25%}.column.is-4-fullhd{flex:none;width:33.33333%}.column.is-offset-4-fullhd{margin-left:33.33333%}.column.is-5-fullhd{flex:none;width:41.66667%}.column.is-offset-5-fullhd{margin-left:41.66667%}.column.is-6-fullhd{flex:none;width:50%}.column.is-offset-6-fullhd{margin-left:50%}.column.is-7-fullhd{flex:none;width:58.33333%}.column.is-offset-7-fullhd{margin-left:58.33333%}.column.is-8-fullhd{flex:none;width:66.66667%}.column.is-offset-8-fullhd{margin-left:66.66667%}.column.is-9-fullhd{flex:none;width:75%}.column.is-offset-9-fullhd{margin-left:75%}.column.is-10-fullhd{flex:none;width:83.33333%}.column.is-offset-10-fullhd{margin-left:83.33333%}.column.is-11-fullhd{flex:none;width:91.66667%}.column.is-offset-11-fullhd{margin-left:91.66667%}.column.is-12-fullhd{flex:none;width:100%}.column.is-offset-12-fullhd{margin-left:100%}}.columns{margin-left:-.75rem;margin-right:-.75rem;margin-top:-.75rem}.columns:last-child{margin-bottom:-.75rem}.columns:not(:last-child){margin-bottom:calc(1.5rem - .75rem)}.columns.is-centered{justify-content:center}.columns.is-gapless{margin-left:0;margin-right:0;margin-top:0}.columns.is-gapless>.column{margin:0;padding:0!important}.columns.is-gapless:not(:last-child){margin-bottom:1.5rem}.columns.is-gapless:last-child{margin-bottom:0}.columns.is-mobile{display:flex}.columns.is-multiline{flex-wrap:wrap}.columns.is-vcentered{align-items:center}@media screen and (min-width:769px),print{.columns:not(.is-desktop){display:flex}}@media screen and (min-width:1024px){.columns.is-desktop{display:flex}}.columns.is-variable{--columnGap:0.75rem;margin-left:calc(-1 * var(--columnGap));margin-right:calc(-1 * var(--columnGap))}.columns.is-variable .column{padding-left:var(--columnGap);padding-right:var(--columnGap)}.columns.is-variable.is-0{--columnGap:0rem}@media screen and (max-width:768px){.columns.is-variable.is-0-mobile{--columnGap:0rem}}@media screen and (min-width:769px),print{.columns.is-variable.is-0-tablet{--columnGap:0rem}}@media screen and (min-width:769px) and (max-width:1023px){.columns.is-variable.is-0-tablet-only{--columnGap:0rem}}@media screen and (max-width:1023px){.columns.is-variable.is-0-touch{--columnGap:0rem}}@media screen and (min-width:1024px){.columns.is-variable.is-0-desktop{--columnGap:0rem}}@media screen and (min-width:1024px) and (max-width:1215px){.columns.is-variable.is-0-desktop-only{--columnGap:0rem}}@media screen and (min-width:1216px){.columns.is-variable.is-0-widescreen{--columnGap:0rem}}@media screen and (min-width:1216px) and (max-width:1407px){.columns.is-variable.is-0-widescreen-only{--columnGap:0rem}}@media screen and (min-width:1408px){.columns.is-variable.is-0-fullhd{--columnGap:0rem}}.columns.is-variable.is-1{--columnGap:0.25rem}@media screen and (max-width:768px){.columns.is-variable.is-1-mobile{--columnGap:0.25rem}}@media screen and (min-width:769px),print{.columns.is-variable.is-1-tablet{--columnGap:0.25rem}}@media screen and (min-width:769px) and (max-width:1023px){.columns.is-variable.is-1-tablet-only{--columnGap:0.25rem}}@media screen and (max-width:1023px){.columns.is-variable.is-1-touch{--columnGap:0.25rem}}@media screen and (min-width:1024px){.columns.is-variable.is-1-desktop{--columnGap:0.25rem}}@media screen and (min-width:1024px) and (max-width:1215px){.columns.is-variable.is-1-desktop-only{--columnGap:0.25rem}}@media screen and (min-width:1216px){.columns.is-variable.is-1-widescreen{--columnGap:0.25rem}}@media screen and (min-width:1216px) and (max-width:1407px){.columns.is-variable.is-1-widescreen-only{--columnGap:0.25rem}}@media screen and (min-width:1408px){.columns.is-variable.is-1-fullhd{--columnGap:0.25rem}}.columns.is-variable.is-2{--columnGap:0.5rem}@media screen and (max-width:768px){.columns.is-variable.is-2-mobile{--columnGap:0.5rem}}@media screen and (min-width:769px),print{.columns.is-variable.is-2-tablet{--columnGap:0.5rem}}@media screen and (min-width:769px) and (max-width:1023px){.columns.is-variable.is-2-tablet-only{--columnGap:0.5rem}}@media screen and (max-width:1023px){.columns.is-variable.is-2-touch{--columnGap:0.5rem}}@media screen and (min-width:1024px){.columns.is-variable.is-2-desktop{--columnGap:0.5rem}}@media screen and (min-width:1024px) and (max-width:1215px){.columns.is-variable.is-2-desktop-only{--columnGap:0.5rem}}@media screen and (min-width:1216px){.columns.is-variable.is-2-widescreen{--columnGap:0.5rem}}@media screen and (min-width:1216px) and (max-width:1407px){.columns.is-variable.is-2-widescreen-only{--columnGap:0.5rem}}@media screen and (min-width:1408px){.columns.is-variable.is-2-fullhd{--columnGap:0.5rem}}.columns.is-variable.is-3{--columnGap:0.75rem}@media screen and (max-width:768px){.columns.is-variable.is-3-mobile{--columnGap:0.75rem}}@media screen and (min-width:769px),print{.columns.is-variable.is-3-tablet{--columnGap:0.75rem}}@media screen and (min-width:769px) and (max-width:1023px){.columns.is-variable.is-3-tablet-only{--columnGap:0.75rem}}@media screen and (max-width:1023px){.columns.is-variable.is-3-touch{--columnGap:0.75rem}}@media screen and (min-width:1024px){.columns.is-variable.is-3-desktop{--columnGap:0.75rem}}@media screen and (min-width:1024px) and (max-width:1215px){.columns.is-variable.is-3-desktop-only{--columnGap:0.75rem}}@media screen and (min-width:1216px){.columns.is-variable.is-3-widescreen{--columnGap:0.75rem}}@media screen and (min-width:1216px) and (max-width:1407px){.columns.is-variable.is-3-widescreen-only{--columnGap:0.75rem}}@media screen and (min-width:1408px){.columns.is-variable.is-3-fullhd{--columnGap:0.75rem}}.columns.is-variable.is-4{--columnGap:1rem}@media screen and (max-width:768px){.columns.is-variable.is-4-mobile{--columnGap:1rem}}@media screen and (min-width:769px),print{.columns.is-variable.is-4-tablet{--columnGap:1rem}}@media screen and (min-width:769px) and (max-width:1023px){.columns.is-variable.is-4-tablet-only{--columnGap:1rem}}@media screen and (max-width:1023px){.columns.is-variable.is-4-touch{--columnGap:1rem}}@media screen and (min-width:1024px){.columns.is-variable.is-4-desktop{--columnGap:1rem}}@media screen and (min-width:1024px) and (max-width:1215px){.columns.is-variable.is-4-desktop-only{--columnGap:1rem}}@media screen and (min-width:1216px){.columns.is-variable.is-4-widescreen{--columnGap:1rem}}@media screen and (min-width:1216px) and (max-width:1407px){.columns.is-variable.is-4-widescreen-only{--columnGap:1rem}}@media screen and (min-width:1408px){.columns.is-variable.is-4-fullhd{--columnGap:1rem}}.columns.is-variable.is-5{--columnGap:1.25rem}@media screen and (max-width:768px){.columns.is-variable.is-5-mobile{--columnGap:1.25rem}}@media screen and (min-width:769px),print{.columns.is-variable.is-5-tablet{--columnGap:1.25rem}}@media screen and (min-width:769px) and (max-width:1023px){.columns.is-variable.is-5-tablet-only{--columnGap:1.25rem}}@media screen and (max-width:1023px){.columns.is-variable.is-5-touch{--columnGap:1.25rem}}@media screen and (min-width:1024px){.columns.is-variable.is-5-desktop{--columnGap:1.25rem}}@media screen and (min-width:1024px) and (max-width:1215px){.columns.is-variable.is-5-desktop-only{--columnGap:1.25rem}}@media screen and (min-width:1216px){.columns.is-variable.is-5-widescreen{--columnGap:1.25rem}}@media screen and (min-width:1216px) and (max-width:1407px){.columns.is-variable.is-5-widescreen-only{--columnGap:1.25rem}}@media screen and (min-width:1408px){.columns.is-variable.is-5-fullhd{--columnGap:1.25rem}}.columns.is-variable.is-6{--columnGap:1.5rem}@media screen and (max-width:768px){.columns.is-variable.is-6-mobile{--columnGap:1.5rem}}@media screen and (min-width:769px),print{.columns.is-variable.is-6-tablet{--columnGap:1.5rem}}@media screen and (min-width:769px) and (max-width:1023px){.columns.is-variable.is-6-tablet-only{--columnGap:1.5rem}}@media screen and (max-width:1023px){.columns.is-variable.is-6-touch{--columnGap:1.5rem}}@media screen and (min-width:1024px){.columns.is-variable.is-6-desktop{--columnGap:1.5rem}}@media screen and (min-width:1024px) and (max-width:1215px){.columns.is-variable.is-6-desktop-only{--columnGap:1.5rem}}@media screen and (min-width:1216px){.columns.is-variable.is-6-widescreen{--columnGap:1.5rem}}@media screen and (min-width:1216px) and (max-width:1407px){.columns.is-variable.is-6-widescreen-only{--columnGap:1.5rem}}@media screen and (min-width:1408px){.columns.is-variable.is-6-fullhd{--columnGap:1.5rem}}.columns.is-variable.is-7{--columnGap:1.75rem}@media screen and (max-width:768px){.columns.is-variable.is-7-mobile{--columnGap:1.75rem}}@media screen and (min-width:769px),print{.columns.is-variable.is-7-tablet{--columnGap:1.75rem}}@media screen and (min-width:769px) and (max-width:1023px){.columns.is-variable.is-7-tablet-only{--columnGap:1.75rem}}@media screen and (max-width:1023px){.columns.is-variable.is-7-touch{--columnGap:1.75rem}}@media screen and (min-width:1024px){.columns.is-variable.is-7-desktop{--columnGap:1.75rem}}@media screen and (min-width:1024px) and (max-width:1215px){.columns.is-variable.is-7-desktop-only{--columnGap:1.75rem}}@media screen and (min-width:1216px){.columns.is-variable.is-7-widescreen{--columnGap:1.75rem}}@media screen and (min-width:1216px) and (max-width:1407px){.columns.is-variable.is-7-widescreen-only{--columnGap:1.75rem}}@media screen and (min-width:1408px){.columns.is-variable.is-7-fullhd{--columnGap:1.75rem}}.columns.is-variable.is-8{--columnGap:2rem}@media screen and (max-width:768px){.columns.is-variable.is-8-mobile{--columnGap:2rem}}@media screen and (min-width:769px),print{.columns.is-variable.is-8-tablet{--columnGap:2rem}}@media screen and (min-width:769px) and (max-width:1023px){.columns.is-variable.is-8-tablet-only{--columnGap:2rem}}@media screen and (max-width:1023px){.columns.is-variable.is-8-touch{--columnGap:2rem}}@media screen and (min-width:1024px){.columns.is-variable.is-8-desktop{--columnGap:2rem}}@media screen and (min-width:1024px) and (max-width:1215px){.columns.is-variable.is-8-desktop-only{--columnGap:2rem}}@media screen and (min-width:1216px){.columns.is-variable.is-8-widescreen{--columnGap:2rem}}@media screen and (min-width:1216px) and (max-width:1407px){.columns.is-variable.is-8-widescreen-only{--columnGap:2rem}}@media screen and (min-width:1408px){.columns.is-variable.is-8-fullhd{--columnGap:2rem}}.tile{align-items:stretch;display:block;flex-basis:0;flex-grow:1;flex-shrink:1;min-height:-webkit-min-content;min-height:-moz-min-content;min-height:min-content}.tile.is-ancestor{margin-left:-.75rem;margin-right:-.75rem;margin-top:-.75rem}.tile.is-ancestor:last-child{margin-bottom:-.75rem}.tile.is-ancestor:not(:last-child){margin-bottom:.75rem}.tile.is-child{margin:0!important}.tile.is-parent{padding:.75rem}.tile.is-vertical{flex-direction:column}.tile.is-vertical>.tile.is-child:not(:last-child){margin-bottom:1.5rem!important}@media screen and (min-width:769px),print{.tile:not(.is-child){display:flex}.tile.is-1{flex:none;width:8.33333%}.tile.is-2{flex:none;width:16.66667%}.tile.is-3{flex:none;width:25%}.tile.is-4{flex:none;width:33.33333%}.tile.is-5{flex:none;width:41.66667%}.tile.is-6{flex:none;width:50%}.tile.is-7{flex:none;width:58.33333%}.tile.is-8{flex:none;width:66.66667%}.tile.is-9{flex:none;width:75%}.tile.is-10{flex:none;width:83.33333%}.tile.is-11{flex:none;width:91.66667%}.tile.is-12{flex:none;width:100%}}.hero{align-items:stretch;display:flex;flex-direction:column;justify-content:space-between}.hero .navbar{background:0 0}.hero .tabs ul{border-bottom:none}.hero.is-white{background-color:#fff;color:#0a0a0a}.hero.is-white a:not(.button):not(.dropdown-item):not(.tag):not(.pagination-link.is-current),.hero.is-white strong{color:inherit}.hero.is-white .title{color:#0a0a0a}.hero.is-white .subtitle{color:rgba(10,10,10,.9)}.hero.is-white .subtitle a:not(.button),.hero.is-white .subtitle strong{color:#0a0a0a}@media screen and (max-width:1023px){.hero.is-white .navbar-menu{background-color:#fff}}.hero.is-white .navbar-item,.hero.is-white .navbar-link{color:rgba(10,10,10,.7)}.hero.is-white .navbar-link.is-active,.hero.is-white .navbar-link:hover,.hero.is-white a.navbar-item.is-active,.hero.is-white a.navbar-item:hover{background-color:#f2f2f2;color:#0a0a0a}.hero.is-white .tabs a{color:#0a0a0a;opacity:.9}.hero.is-white .tabs a:hover{opacity:1}.hero.is-white .tabs li.is-active a{opacity:1}.hero.is-white .tabs.is-boxed a,.hero.is-white .tabs.is-toggle a{color:#0a0a0a}.hero.is-white .tabs.is-boxed a:hover,.hero.is-white .tabs.is-toggle a:hover{background-color:rgba(10,10,10,.1)}.hero.is-white .tabs.is-boxed li.is-active a,.hero.is-white .tabs.is-boxed li.is-active a:hover,.hero.is-white .tabs.is-toggle li.is-active a,.hero.is-white .tabs.is-toggle li.is-active a:hover{background-color:#0a0a0a;border-color:#0a0a0a;color:#fff}.hero.is-white.is-bold{background-image:linear-gradient(141deg,#e6e6e6 0,#fff 71%,#fff 100%)}@media screen and (max-width:768px){.hero.is-white.is-bold .navbar-menu{background-image:linear-gradient(141deg,#e6e6e6 0,#fff 71%,#fff 100%)}}.hero.is-black{background-color:#0a0a0a;color:#fff}.hero.is-black a:not(.button):not(.dropdown-item):not(.tag):not(.pagination-link.is-current),.hero.is-black strong{color:inherit}.hero.is-black .title{color:#fff}.hero.is-black .subtitle{color:rgba(255,255,255,.9)}.hero.is-black .subtitle a:not(.button),.hero.is-black .subtitle strong{color:#fff}@media screen and (max-width:1023px){.hero.is-black .navbar-menu{background-color:#0a0a0a}}.hero.is-black .navbar-item,.hero.is-black .navbar-link{color:rgba(255,255,255,.7)}.hero.is-black .navbar-link.is-active,.hero.is-black .navbar-link:hover,.hero.is-black a.navbar-item.is-active,.hero.is-black a.navbar-item:hover{background-color:#000;color:#fff}.hero.is-black .tabs a{color:#fff;opacity:.9}.hero.is-black .tabs a:hover{opacity:1}.hero.is-black .tabs li.is-active a{opacity:1}.hero.is-black .tabs.is-boxed a,.hero.is-black .tabs.is-toggle a{color:#fff}.hero.is-black .tabs.is-boxed a:hover,.hero.is-black .tabs.is-toggle a:hover{background-color:rgba(10,10,10,.1)}.hero.is-black .tabs.is-boxed li.is-active a,.hero.is-black .tabs.is-boxed li.is-active a:hover,.hero.is-black .tabs.is-toggle li.is-active a,.hero.is-black .tabs.is-toggle li.is-active a:hover{background-color:#fff;border-color:#fff;color:#0a0a0a}.hero.is-black.is-bold{background-image:linear-gradient(141deg,#000 0,#0a0a0a 71%,#181616 100%)}@media screen and (max-width:768px){.hero.is-black.is-bold .navbar-menu{background-image:linear-gradient(141deg,#000 0,#0a0a0a 71%,#181616 100%)}}.hero.is-light{background-color:#f5f5f5;color:rgba(0,0,0,.7)}.hero.is-light a:not(.button):not(.dropdown-item):not(.tag):not(.pagination-link.is-current),.hero.is-light strong{color:inherit}.hero.is-light .title{color:rgba(0,0,0,.7)}.hero.is-light .subtitle{color:rgba(0,0,0,.9)}.hero.is-light .subtitle a:not(.button),.hero.is-light .subtitle strong{color:rgba(0,0,0,.7)}@media screen and (max-width:1023px){.hero.is-light .navbar-menu{background-color:#f5f5f5}}.hero.is-light .navbar-item,.hero.is-light .navbar-link{color:rgba(0,0,0,.7)}.hero.is-light .navbar-link.is-active,.hero.is-light .navbar-link:hover,.hero.is-light a.navbar-item.is-active,.hero.is-light a.navbar-item:hover{background-color:#e8e8e8;color:rgba(0,0,0,.7)}.hero.is-light .tabs a{color:rgba(0,0,0,.7);opacity:.9}.hero.is-light .tabs a:hover{opacity:1}.hero.is-light .tabs li.is-active a{opacity:1}.hero.is-light .tabs.is-boxed a,.hero.is-light .tabs.is-toggle a{color:rgba(0,0,0,.7)}.hero.is-light .tabs.is-boxed a:hover,.hero.is-light .tabs.is-toggle a:hover{background-color:rgba(10,10,10,.1)}.hero.is-light .tabs.is-boxed li.is-active a,.hero.is-light .tabs.is-boxed li.is-active a:hover,.hero.is-light .tabs.is-toggle li.is-active a,.hero.is-light .tabs.is-toggle li.is-active a:hover{background-color:rgba(0,0,0,.7);border-color:rgba(0,0,0,.7);color:#f5f5f5}.hero.is-light.is-bold{background-image:linear-gradient(141deg,#dfd8d9 0,#f5f5f5 71%,#fff 100%)}@media screen and (max-width:768px){.hero.is-light.is-bold .navbar-menu{background-image:linear-gradient(141deg,#dfd8d9 0,#f5f5f5 71%,#fff 100%)}}.hero.is-dark{background-color:#363636;color:#fff}.hero.is-dark a:not(.button):not(.dropdown-item):not(.tag):not(.pagination-link.is-current),.hero.is-dark strong{color:inherit}.hero.is-dark .title{color:#fff}.hero.is-dark .subtitle{color:rgba(255,255,255,.9)}.hero.is-dark .subtitle a:not(.button),.hero.is-dark .subtitle strong{color:#fff}@media screen and (max-width:1023px){.hero.is-dark .navbar-menu{background-color:#363636}}.hero.is-dark .navbar-item,.hero.is-dark .navbar-link{color:rgba(255,255,255,.7)}.hero.is-dark .navbar-link.is-active,.hero.is-dark .navbar-link:hover,.hero.is-dark a.navbar-item.is-active,.hero.is-dark a.navbar-item:hover{background-color:#292929;color:#fff}.hero.is-dark .tabs a{color:#fff;opacity:.9}.hero.is-dark .tabs a:hover{opacity:1}.hero.is-dark .tabs li.is-active a{opacity:1}.hero.is-dark .tabs.is-boxed a,.hero.is-dark .tabs.is-toggle a{color:#fff}.hero.is-dark .tabs.is-boxed a:hover,.hero.is-dark .tabs.is-toggle a:hover{background-color:rgba(10,10,10,.1)}.hero.is-dark .tabs.is-boxed li.is-active a,.hero.is-dark .tabs.is-boxed li.is-active a:hover,.hero.is-dark .tabs.is-toggle li.is-active a,.hero.is-dark .tabs.is-toggle li.is-active a:hover{background-color:#fff;border-color:#fff;color:#363636}.hero.is-dark.is-bold{background-image:linear-gradient(141deg,#1f191a 0,#363636 71%,#46403f 100%)}@media screen and (max-width:768px){.hero.is-dark.is-bold .navbar-menu{background-image:linear-gradient(141deg,#1f191a 0,#363636 71%,#46403f 100%)}}.hero.is-primary{background-color:#00d1b2;color:#fff}.hero.is-primary a:not(.button):not(.dropdown-item):not(.tag):not(.pagination-link.is-current),.hero.is-primary strong{color:inherit}.hero.is-primary .title{color:#fff}.hero.is-primary .subtitle{color:rgba(255,255,255,.9)}.hero.is-primary .subtitle a:not(.button),.hero.is-primary .subtitle strong{color:#fff}@media screen and (max-width:1023px){.hero.is-primary .navbar-menu{background-color:#00d1b2}}.hero.is-primary .navbar-item,.hero.is-primary .navbar-link{color:rgba(255,255,255,.7)}.hero.is-primary .navbar-link.is-active,.hero.is-primary .navbar-link:hover,.hero.is-primary a.navbar-item.is-active,.hero.is-primary a.navbar-item:hover{background-color:#00b89c;color:#fff}.hero.is-primary .tabs a{color:#fff;opacity:.9}.hero.is-primary .tabs a:hover{opacity:1}.hero.is-primary .tabs li.is-active a{opacity:1}.hero.is-primary .tabs.is-boxed a,.hero.is-primary .tabs.is-toggle a{color:#fff}.hero.is-primary .tabs.is-boxed a:hover,.hero.is-primary .tabs.is-toggle a:hover{background-color:rgba(10,10,10,.1)}.hero.is-primary .tabs.is-boxed li.is-active a,.hero.is-primary .tabs.is-boxed li.is-active a:hover,.hero.is-primary .tabs.is-toggle li.is-active a,.hero.is-primary .tabs.is-toggle li.is-active a:hover{background-color:#fff;border-color:#fff;color:#00d1b2}.hero.is-primary.is-bold{background-image:linear-gradient(141deg,#009e6c 0,#00d1b2 71%,#00e7eb 100%)}@media screen and (max-width:768px){.hero.is-primary.is-bold .navbar-menu{background-image:linear-gradient(141deg,#009e6c 0,#00d1b2 71%,#00e7eb 100%)}}.hero.is-link{background-color:#3273dc;color:#fff}.hero.is-link a:not(.button):not(.dropdown-item):not(.tag):not(.pagination-link.is-current),.hero.is-link strong{color:inherit}.hero.is-link .title{color:#fff}.hero.is-link .subtitle{color:rgba(255,255,255,.9)}.hero.is-link .subtitle a:not(.button),.hero.is-link .subtitle strong{color:#fff}@media screen and (max-width:1023px){.hero.is-link .navbar-menu{background-color:#3273dc}}.hero.is-link .navbar-item,.hero.is-link .navbar-link{color:rgba(255,255,255,.7)}.hero.is-link .navbar-link.is-active,.hero.is-link .navbar-link:hover,.hero.is-link a.navbar-item.is-active,.hero.is-link a.navbar-item:hover{background-color:#2366d1;color:#fff}.hero.is-link .tabs a{color:#fff;opacity:.9}.hero.is-link .tabs a:hover{opacity:1}.hero.is-link .tabs li.is-active a{opacity:1}.hero.is-link .tabs.is-boxed a,.hero.is-link .tabs.is-toggle a{color:#fff}.hero.is-link .tabs.is-boxed a:hover,.hero.is-link .tabs.is-toggle a:hover{background-color:rgba(10,10,10,.1)}.hero.is-link .tabs.is-boxed li.is-active a,.hero.is-link .tabs.is-boxed li.is-active a:hover,.hero.is-link .tabs.is-toggle li.is-active a,.hero.is-link .tabs.is-toggle li.is-active a:hover{background-color:#fff;border-color:#fff;color:#3273dc}.hero.is-link.is-bold{background-image:linear-gradient(141deg,#1577c6 0,#3273dc 71%,#4366e5 100%)}@media screen and (max-width:768px){.hero.is-link.is-bold .navbar-menu{background-image:linear-gradient(141deg,#1577c6 0,#3273dc 71%,#4366e5 100%)}}.hero.is-info{background-color:#3298dc;color:#fff}.hero.is-info a:not(.button):not(.dropdown-item):not(.tag):not(.pagination-link.is-current),.hero.is-info strong{color:inherit}.hero.is-info .title{color:#fff}.hero.is-info .subtitle{color:rgba(255,255,255,.9)}.hero.is-info .subtitle a:not(.button),.hero.is-info .subtitle strong{color:#fff}@media screen and (max-width:1023px){.hero.is-info .navbar-menu{background-color:#3298dc}}.hero.is-info .navbar-item,.hero.is-info .navbar-link{color:rgba(255,255,255,.7)}.hero.is-info .navbar-link.is-active,.hero.is-info .navbar-link:hover,.hero.is-info a.navbar-item.is-active,.hero.is-info a.navbar-item:hover{background-color:#238cd1;color:#fff}.hero.is-info .tabs a{color:#fff;opacity:.9}.hero.is-info .tabs a:hover{opacity:1}.hero.is-info .tabs li.is-active a{opacity:1}.hero.is-info .tabs.is-boxed a,.hero.is-info .tabs.is-toggle a{color:#fff}.hero.is-info .tabs.is-boxed a:hover,.hero.is-info .tabs.is-toggle a:hover{background-color:rgba(10,10,10,.1)}.hero.is-info .tabs.is-boxed li.is-active a,.hero.is-info .tabs.is-boxed li.is-active a:hover,.hero.is-info .tabs.is-toggle li.is-active a,.hero.is-info .tabs.is-toggle li.is-active a:hover{background-color:#fff;border-color:#fff;color:#3298dc}.hero.is-info.is-bold{background-image:linear-gradient(141deg,#159dc6 0,#3298dc 71%,#4389e5 100%)}@media screen and (max-width:768px){.hero.is-info.is-bold .navbar-menu{background-image:linear-gradient(141deg,#159dc6 0,#3298dc 71%,#4389e5 100%)}}.hero.is-success{background-color:#48c774;color:#fff}.hero.is-success a:not(.button):not(.dropdown-item):not(.tag):not(.pagination-link.is-current),.hero.is-success strong{color:inherit}.hero.is-success .title{color:#fff}.hero.is-success .subtitle{color:rgba(255,255,255,.9)}.hero.is-success .subtitle a:not(.button),.hero.is-success .subtitle strong{color:#fff}@media screen and (max-width:1023px){.hero.is-success .navbar-menu{background-color:#48c774}}.hero.is-success .navbar-item,.hero.is-success .navbar-link{color:rgba(255,255,255,.7)}.hero.is-success .navbar-link.is-active,.hero.is-success .navbar-link:hover,.hero.is-success a.navbar-item.is-active,.hero.is-success a.navbar-item:hover{background-color:#3abb67;color:#fff}.hero.is-success .tabs a{color:#fff;opacity:.9}.hero.is-success .tabs a:hover{opacity:1}.hero.is-success .tabs li.is-active a{opacity:1}.hero.is-success .tabs.is-boxed a,.hero.is-success .tabs.is-toggle a{color:#fff}.hero.is-success .tabs.is-boxed a:hover,.hero.is-success .tabs.is-toggle a:hover{background-color:rgba(10,10,10,.1)}.hero.is-success .tabs.is-boxed li.is-active a,.hero.is-success .tabs.is-boxed li.is-active a:hover,.hero.is-success .tabs.is-toggle li.is-active a,.hero.is-success .tabs.is-toggle li.is-active a:hover{background-color:#fff;border-color:#fff;color:#48c774}.hero.is-success.is-bold{background-image:linear-gradient(141deg,#29b342 0,#48c774 71%,#56d296 100%)}@media screen and (max-width:768px){.hero.is-success.is-bold .navbar-menu{background-image:linear-gradient(141deg,#29b342 0,#48c774 71%,#56d296 100%)}}.hero.is-warning{background-color:#ffdd57;color:rgba(0,0,0,.7)}.hero.is-warning a:not(.button):not(.dropdown-item):not(.tag):not(.pagination-link.is-current),.hero.is-warning strong{color:inherit}.hero.is-warning .title{color:rgba(0,0,0,.7)}.hero.is-warning .subtitle{color:rgba(0,0,0,.9)}.hero.is-warning .subtitle a:not(.button),.hero.is-warning .subtitle strong{color:rgba(0,0,0,.7)}@media screen and (max-width:1023px){.hero.is-warning .navbar-menu{background-color:#ffdd57}}.hero.is-warning .navbar-item,.hero.is-warning .navbar-link{color:rgba(0,0,0,.7)}.hero.is-warning .navbar-link.is-active,.hero.is-warning .navbar-link:hover,.hero.is-warning a.navbar-item.is-active,.hero.is-warning a.navbar-item:hover{background-color:#ffd83d;color:rgba(0,0,0,.7)}.hero.is-warning .tabs a{color:rgba(0,0,0,.7);opacity:.9}.hero.is-warning .tabs a:hover{opacity:1}.hero.is-warning .tabs li.is-active a{opacity:1}.hero.is-warning .tabs.is-boxed a,.hero.is-warning .tabs.is-toggle a{color:rgba(0,0,0,.7)}.hero.is-warning .tabs.is-boxed a:hover,.hero.is-warning .tabs.is-toggle a:hover{background-color:rgba(10,10,10,.1)}.hero.is-warning .tabs.is-boxed li.is-active a,.hero.is-warning .tabs.is-boxed li.is-active a:hover,.hero.is-warning .tabs.is-toggle li.is-active a,.hero.is-warning .tabs.is-toggle li.is-active a:hover{background-color:rgba(0,0,0,.7);border-color:rgba(0,0,0,.7);color:#ffdd57}.hero.is-warning.is-bold{background-image:linear-gradient(141deg,#ffaf24 0,#ffdd57 71%,#fffa70 100%)}@media screen and (max-width:768px){.hero.is-warning.is-bold .navbar-menu{background-image:linear-gradient(141deg,#ffaf24 0,#ffdd57 71%,#fffa70 100%)}}.hero.is-danger{background-color:#f14668;color:#fff}.hero.is-danger a:not(.button):not(.dropdown-item):not(.tag):not(.pagination-link.is-current),.hero.is-danger strong{color:inherit}.hero.is-danger .title{color:#fff}.hero.is-danger .subtitle{color:rgba(255,255,255,.9)}.hero.is-danger .subtitle a:not(.button),.hero.is-danger .subtitle strong{color:#fff}@media screen and (max-width:1023px){.hero.is-danger .navbar-menu{background-color:#f14668}}.hero.is-danger .navbar-item,.hero.is-danger .navbar-link{color:rgba(255,255,255,.7)}.hero.is-danger .navbar-link.is-active,.hero.is-danger .navbar-link:hover,.hero.is-danger a.navbar-item.is-active,.hero.is-danger a.navbar-item:hover{background-color:#ef2e55;color:#fff}.hero.is-danger .tabs a{color:#fff;opacity:.9}.hero.is-danger .tabs a:hover{opacity:1}.hero.is-danger .tabs li.is-active a{opacity:1}.hero.is-danger .tabs.is-boxed a,.hero.is-danger .tabs.is-toggle a{color:#fff}.hero.is-danger .tabs.is-boxed a:hover,.hero.is-danger .tabs.is-toggle a:hover{background-color:rgba(10,10,10,.1)}.hero.is-danger .tabs.is-boxed li.is-active a,.hero.is-danger .tabs.is-boxed li.is-active a:hover,.hero.is-danger .tabs.is-toggle li.is-active a,.hero.is-danger .tabs.is-toggle li.is-active a:hover{background-color:#fff;border-color:#fff;color:#f14668}.hero.is-danger.is-bold{background-image:linear-gradient(141deg,#fa0a62 0,#f14668 71%,#f7595f 100%)}@media screen and (max-width:768px){.hero.is-danger.is-bold .navbar-menu{background-image:linear-gradient(141deg,#fa0a62 0,#f14668 71%,#f7595f 100%)}}.hero.is-small .hero-body{padding-bottom:1.5rem;padding-top:1.5rem}@media screen and (min-width:769px),print{.hero.is-medium .hero-body{padding-bottom:9rem;padding-top:9rem}}@media screen and (min-width:769px),print{.hero.is-large .hero-body{padding-bottom:18rem;padding-top:18rem}}.hero.is-fullheight .hero-body,.hero.is-fullheight-with-navbar .hero-body,.hero.is-halfheight .hero-body{align-items:center;display:flex}.hero.is-fullheight .hero-body>.container,.hero.is-fullheight-with-navbar .hero-body>.container,.hero.is-halfheight .hero-body>.container{flex-grow:1;flex-shrink:1}.hero.is-halfheight{min-height:50vh}.hero.is-fullheight{min-height:100vh}.hero-video{overflow:hidden}.hero-video video{left:50%;min-height:100%;min-width:100%;position:absolute;top:50%;transform:translate3d(-50%,-50%,0)}.hero-video.is-transparent{opacity:.3}@media screen and (max-width:768px){.hero-video{display:none}}.hero-buttons{margin-top:1.5rem}@media screen and (max-width:768px){.hero-buttons .button{display:flex}.hero-buttons .button:not(:last-child){margin-bottom:.75rem}}@media screen and (min-width:769px),print{.hero-buttons{display:flex;justify-content:center}.hero-buttons .button:not(:last-child){margin-right:1.5rem}}.hero-foot,.hero-head{flex-grow:0;flex-shrink:0}.hero-body{flex-grow:1;flex-shrink:0;padding:3rem 1.5rem}.section{padding:3rem 1.5rem}@media screen and (min-width:1024px){.section.is-medium{padding:9rem 1.5rem}.section.is-large{padding:18rem 1.5rem}}.footer{background-color:#fafafa;padding:3rem 1.5rem 6rem}";
    styleInject(css);

    /* node_modules/svelte-feather-icons/src/icons/RadioIcon.svelte generated by Svelte v3.19.2 */

    const file = "node_modules/svelte-feather-icons/src/icons/RadioIcon.svelte";

    function create_fragment(ctx) {
    	let svg;
    	let circle;
    	let path;
    	let svg_class_value;

    	const block = {
    		c: function create() {
    			svg = svg_element("svg");
    			circle = svg_element("circle");
    			path = svg_element("path");
    			attr_dev(circle, "cx", "12");
    			attr_dev(circle, "cy", "12");
    			attr_dev(circle, "r", "2");
    			add_location(circle, file, 12, 230, 486);
    			attr_dev(path, "d", "M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14");
    			add_location(path, file, 12, 269, 525);
    			attr_dev(svg, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg, "width", /*size*/ ctx[0]);
    			attr_dev(svg, "height", /*size*/ ctx[0]);
    			attr_dev(svg, "fill", "none");
    			attr_dev(svg, "viewBox", "0 0 24 24");
    			attr_dev(svg, "stroke", "currentColor");
    			attr_dev(svg, "stroke-width", "2");
    			attr_dev(svg, "stroke-linecap", "round");
    			attr_dev(svg, "stroke-linejoin", "round");
    			attr_dev(svg, "class", svg_class_value = "feather feather-radio " + /*customClass*/ ctx[1]);
    			add_location(svg, file, 12, 0, 256);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, svg, anchor);
    			append_dev(svg, circle);
    			append_dev(svg, path);
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*size*/ 1) {
    				attr_dev(svg, "width", /*size*/ ctx[0]);
    			}

    			if (dirty & /*size*/ 1) {
    				attr_dev(svg, "height", /*size*/ ctx[0]);
    			}

    			if (dirty & /*customClass*/ 2 && svg_class_value !== (svg_class_value = "feather feather-radio " + /*customClass*/ ctx[1])) {
    				attr_dev(svg, "class", svg_class_value);
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(svg);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { size = "100%" } = $$props;
    	let { class: customClass = "" } = $$props;

    	if (size !== "100%") {
    		size = size.slice(-1) === "x"
    		? size.slice(0, size.length - 1) + "em"
    		: parseInt(size) + "px";
    	}

    	const writable_props = ["size", "class"];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<RadioIcon> was created with unknown prop '${key}'`);
    	});

    	let { $$slots = {}, $$scope } = $$props;
    	validate_slots("RadioIcon", $$slots, []);

    	$$self.$set = $$props => {
    		if ("size" in $$props) $$invalidate(0, size = $$props.size);
    		if ("class" in $$props) $$invalidate(1, customClass = $$props.class);
    	};

    	$$self.$capture_state = () => ({ size, customClass });

    	$$self.$inject_state = $$props => {
    		if ("size" in $$props) $$invalidate(0, size = $$props.size);
    		if ("customClass" in $$props) $$invalidate(1, customClass = $$props.customClass);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [size, customClass];
    }

    class RadioIcon extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, { size: 0, class: 1 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "RadioIcon",
    			options,
    			id: create_fragment.name
    		});
    	}

    	get size() {
    		throw new Error("<RadioIcon>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set size(value) {
    		throw new Error("<RadioIcon>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get class() {
    		throw new Error("<RadioIcon>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set class(value) {
    		throw new Error("<RadioIcon>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* node_modules/svelte-feather-icons/src/icons/RefreshCwIcon.svelte generated by Svelte v3.19.2 */

    const file$1 = "node_modules/svelte-feather-icons/src/icons/RefreshCwIcon.svelte";

    function create_fragment$1(ctx) {
    	let svg;
    	let polyline0;
    	let polyline1;
    	let path;
    	let svg_class_value;

    	const block = {
    		c: function create() {
    			svg = svg_element("svg");
    			polyline0 = svg_element("polyline");
    			polyline1 = svg_element("polyline");
    			path = svg_element("path");
    			attr_dev(polyline0, "points", "23 4 23 10 17 10");
    			add_location(polyline0, file$1, 12, 235, 491);
    			attr_dev(polyline1, "points", "1 20 1 14 7 14");
    			add_location(polyline1, file$1, 12, 282, 538);
    			attr_dev(path, "d", "M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15");
    			add_location(path, file$1, 12, 327, 583);
    			attr_dev(svg, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg, "width", /*size*/ ctx[0]);
    			attr_dev(svg, "height", /*size*/ ctx[0]);
    			attr_dev(svg, "fill", "none");
    			attr_dev(svg, "viewBox", "0 0 24 24");
    			attr_dev(svg, "stroke", "currentColor");
    			attr_dev(svg, "stroke-width", "2");
    			attr_dev(svg, "stroke-linecap", "round");
    			attr_dev(svg, "stroke-linejoin", "round");
    			attr_dev(svg, "class", svg_class_value = "feather feather-refresh-cw " + /*customClass*/ ctx[1]);
    			add_location(svg, file$1, 12, 0, 256);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, svg, anchor);
    			append_dev(svg, polyline0);
    			append_dev(svg, polyline1);
    			append_dev(svg, path);
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*size*/ 1) {
    				attr_dev(svg, "width", /*size*/ ctx[0]);
    			}

    			if (dirty & /*size*/ 1) {
    				attr_dev(svg, "height", /*size*/ ctx[0]);
    			}

    			if (dirty & /*customClass*/ 2 && svg_class_value !== (svg_class_value = "feather feather-refresh-cw " + /*customClass*/ ctx[1])) {
    				attr_dev(svg, "class", svg_class_value);
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(svg);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { size = "100%" } = $$props;
    	let { class: customClass = "" } = $$props;

    	if (size !== "100%") {
    		size = size.slice(-1) === "x"
    		? size.slice(0, size.length - 1) + "em"
    		: parseInt(size) + "px";
    	}

    	const writable_props = ["size", "class"];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<RefreshCwIcon> was created with unknown prop '${key}'`);
    	});

    	let { $$slots = {}, $$scope } = $$props;
    	validate_slots("RefreshCwIcon", $$slots, []);

    	$$self.$set = $$props => {
    		if ("size" in $$props) $$invalidate(0, size = $$props.size);
    		if ("class" in $$props) $$invalidate(1, customClass = $$props.class);
    	};

    	$$self.$capture_state = () => ({ size, customClass });

    	$$self.$inject_state = $$props => {
    		if ("size" in $$props) $$invalidate(0, size = $$props.size);
    		if ("customClass" in $$props) $$invalidate(1, customClass = $$props.customClass);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [size, customClass];
    }

    class RefreshCwIcon extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, { size: 0, class: 1 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "RefreshCwIcon",
    			options,
    			id: create_fragment$1.name
    		});
    	}

    	get size() {
    		throw new Error("<RefreshCwIcon>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set size(value) {
    		throw new Error("<RefreshCwIcon>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get class() {
    		throw new Error("<RefreshCwIcon>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set class(value) {
    		throw new Error("<RefreshCwIcon>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    function createCommonjsModule(fn, module) {
    	return module = { exports: {} }, fn(module, module.exports), module.exports;
    }

    var smoothie = createCommonjsModule(function (module, exports) {
    (function(exports) {

      // Date.now polyfill
      Date.now = Date.now || function() { return new Date().getTime(); };

      var Util = {
        extend: function() {
          arguments[0] = arguments[0] || {};
          for (var i = 1; i < arguments.length; i++)
          {
            for (var key in arguments[i])
            {
              if (arguments[i].hasOwnProperty(key))
              {
                if (typeof(arguments[i][key]) === 'object') {
                  if (arguments[i][key] instanceof Array) {
                    arguments[0][key] = arguments[i][key];
                  } else {
                    arguments[0][key] = Util.extend(arguments[0][key], arguments[i][key]);
                  }
                } else {
                  arguments[0][key] = arguments[i][key];
                }
              }
            }
          }
          return arguments[0];
        },
        binarySearch: function(data, value) {
          var low = 0,
              high = data.length;
          while (low < high) {
            var mid = (low + high) >> 1;
            if (value < data[mid][0])
              high = mid;
            else
              low = mid + 1;
          }
          return low;
        }
      };

      /**
       * Initialises a new <code>TimeSeries</code> with optional data options.
       *
       * Options are of the form (defaults shown):
       *
       * <pre>
       * {
       *   resetBounds: true,        // enables/disables automatic scaling of the y-axis
       *   resetBoundsInterval: 3000 // the period between scaling calculations, in millis
       * }
       * </pre>
       *
       * Presentation options for TimeSeries are specified as an argument to <code>SmoothieChart.addTimeSeries</code>.
       *
       * @constructor
       */
      function TimeSeries(options) {
        this.options = Util.extend({}, TimeSeries.defaultOptions, options);
        this.disabled = false;
        this.clear();
      }

      TimeSeries.defaultOptions = {
        resetBoundsInterval: 3000,
        resetBounds: true
      };

      /**
       * Clears all data and state from this TimeSeries object.
       */
      TimeSeries.prototype.clear = function() {
        this.data = [];
        this.maxValue = Number.NaN; // The maximum value ever seen in this TimeSeries.
        this.minValue = Number.NaN; // The minimum value ever seen in this TimeSeries.
      };

      /**
       * Recalculate the min/max values for this <code>TimeSeries</code> object.
       *
       * This causes the graph to scale itself in the y-axis.
       */
      TimeSeries.prototype.resetBounds = function() {
        if (this.data.length) {
          // Walk through all data points, finding the min/max value
          this.maxValue = this.data[0][1];
          this.minValue = this.data[0][1];
          for (var i = 1; i < this.data.length; i++) {
            var value = this.data[i][1];
            if (value > this.maxValue) {
              this.maxValue = value;
            }
            if (value < this.minValue) {
              this.minValue = value;
            }
          }
        } else {
          // No data exists, so set min/max to NaN
          this.maxValue = Number.NaN;
          this.minValue = Number.NaN;
        }
      };

      /**
       * Adds a new data point to the <code>TimeSeries</code>, preserving chronological order.
       *
       * @param timestamp the position, in time, of this data point
       * @param value the value of this data point
       * @param sumRepeatedTimeStampValues if <code>timestamp</code> has an exact match in the series, this flag controls
       * whether it is replaced, or the values summed (defaults to false.)
       */
      TimeSeries.prototype.append = function(timestamp, value, sumRepeatedTimeStampValues) {
        // Rewind until we hit an older timestamp
        var i = this.data.length - 1;
        while (i >= 0 && this.data[i][0] > timestamp) {
          i--;
        }

        if (i === -1) {
          // This new item is the oldest data
          this.data.splice(0, 0, [timestamp, value]);
        } else if (this.data.length > 0 && this.data[i][0] === timestamp) {
          // Update existing values in the array
          if (sumRepeatedTimeStampValues) {
            // Sum this value into the existing 'bucket'
            this.data[i][1] += value;
            value = this.data[i][1];
          } else {
            // Replace the previous value
            this.data[i][1] = value;
          }
        } else if (i < this.data.length - 1) {
          // Splice into the correct position to keep timestamps in order
          this.data.splice(i + 1, 0, [timestamp, value]);
        } else {
          // Add to the end of the array
          this.data.push([timestamp, value]);
        }

        this.maxValue = isNaN(this.maxValue) ? value : Math.max(this.maxValue, value);
        this.minValue = isNaN(this.minValue) ? value : Math.min(this.minValue, value);
      };

      TimeSeries.prototype.dropOldData = function(oldestValidTime, maxDataSetLength) {
        // We must always keep one expired data point as we need this to draw the
        // line that comes into the chart from the left, but any points prior to that can be removed.
        var removeCount = 0;
        while (this.data.length - removeCount >= maxDataSetLength && this.data[removeCount + 1][0] < oldestValidTime) {
          removeCount++;
        }
        if (removeCount !== 0) {
          this.data.splice(0, removeCount);
        }
      };

      /**
       * Initialises a new <code>SmoothieChart</code>.
       *
       * Options are optional, and should be of the form below. Just specify the values you
       * need and the rest will be given sensible defaults as shown:
       *
       * <pre>
       * {
       *   minValue: undefined,                      // specify to clamp the lower y-axis to a given value
       *   maxValue: undefined,                      // specify to clamp the upper y-axis to a given value
       *   maxValueScale: 1,                         // allows proportional padding to be added above the chart. for 10% padding, specify 1.1.
       *   minValueScale: 1,                         // allows proportional padding to be added below the chart. for 10% padding, specify 1.1.
       *   yRangeFunction: undefined,                // function({min: , max: }) { return {min: , max: }; }
       *   scaleSmoothing: 0.125,                    // controls the rate at which y-value zoom animation occurs
       *   millisPerPixel: 20,                       // sets the speed at which the chart pans by
       *   enableDpiScaling: true,                   // support rendering at different DPI depending on the device
       *   yMinFormatter: function(min, precision) { // callback function that formats the min y value label
       *     return parseFloat(min).toFixed(precision);
       *   },
       *   yMaxFormatter: function(max, precision) { // callback function that formats the max y value label
       *     return parseFloat(max).toFixed(precision);
       *   },
       *   yIntermediateFormatter: function(intermediate, precision) { // callback function that formats the intermediate y value labels
       *     return parseFloat(intermediate).toFixed(precision);
       *   },
       *   maxDataSetLength: 2,
       *   interpolation: 'bezier'                   // one of 'bezier', 'linear', or 'step'
       *   timestampFormatter: null,                 // optional function to format time stamps for bottom of chart
       *                                             // you may use SmoothieChart.timeFormatter, or your own: function(date) { return ''; }
       *   scrollBackwards: false,                   // reverse the scroll direction of the chart
       *   horizontalLines: [],                      // [ { value: 0, color: '#ffffff', lineWidth: 1 } ]
       *   grid:
       *   {
       *     fillStyle: '#000000',                   // the background colour of the chart
       *     lineWidth: 1,                           // the pixel width of grid lines
       *     strokeStyle: '#777777',                 // colour of grid lines
       *     millisPerLine: 1000,                    // distance between vertical grid lines
       *     sharpLines: false,                      // controls whether grid lines are 1px sharp, or softened
       *     verticalSections: 2,                    // number of vertical sections marked out by horizontal grid lines
       *     borderVisible: true                     // whether the grid lines trace the border of the chart or not
       *   },
       *   labels
       *   {
       *     disabled: false,                        // enables/disables labels showing the min/max values
       *     fillStyle: '#ffffff',                   // colour for text of labels,
       *     fontSize: 15,
       *     fontFamily: 'sans-serif',
       *     precision: 2,
       *     showIntermediateLabels: false,          // shows intermediate labels between min and max values along y axis
       *     intermediateLabelSameAxis: true,
       *   },
       *   tooltip: false                            // show tooltip when mouse is over the chart
       *   tooltipLine: {                            // properties for a vertical line at the cursor position
       *     lineWidth: 1,
       *     strokeStyle: '#BBBBBB'
       *   },
       *   tooltipFormatter: SmoothieChart.tooltipFormatter, // formatter function for tooltip text
       *   nonRealtimeData: false,                   // use time of latest data as current time
       *   displayDataFromPercentile: 1,             // display not latest data, but data from the given percentile
       *                                             // useful when trying to see old data saved by setting a high value for maxDataSetLength
       *                                             // should be a value between 0 and 1
       *   responsive: false,                        // whether the chart should adapt to the size of the canvas
       *   limitFPS: 0                               // maximum frame rate the chart will render at, in FPS (zero means no limit)
       * }
       * </pre>
       *
       * @constructor
       */
      function SmoothieChart(options) {
        this.options = Util.extend({}, SmoothieChart.defaultChartOptions, options);
        this.seriesSet = [];
        this.currentValueRange = 1;
        this.currentVisMinValue = 0;
        this.lastRenderTimeMillis = 0;
        this.lastChartTimestamp = 0;

        this.mousemove = this.mousemove.bind(this);
        this.mouseout = this.mouseout.bind(this);
      }

      /** Formats the HTML string content of the tooltip. */
      SmoothieChart.tooltipFormatter = function (timestamp, data) {
          var timestampFormatter = this.options.timestampFormatter || SmoothieChart.timeFormatter,
              lines = [timestampFormatter(new Date(timestamp))];

          for (var i = 0; i < data.length; ++i) {
            lines.push('<span style="color:' + data[i].series.options.strokeStyle + '">' +
            this.options.yMaxFormatter(data[i].value, this.options.labels.precision) + '</span>');
          }

          return lines.join('<br>');
      };

      SmoothieChart.defaultChartOptions = {
        millisPerPixel: 20,
        enableDpiScaling: true,
        yMinFormatter: function(min, precision) {
          return parseFloat(min).toFixed(precision);
        },
        yMaxFormatter: function(max, precision) {
          return parseFloat(max).toFixed(precision);
        },
        yIntermediateFormatter: function(intermediate, precision) {
          return parseFloat(intermediate).toFixed(precision);
        },
        maxValueScale: 1,
        minValueScale: 1,
        interpolation: 'bezier',
        scaleSmoothing: 0.125,
        maxDataSetLength: 2,
        scrollBackwards: false,
        displayDataFromPercentile: 1,
        grid: {
          fillStyle: '#000000',
          strokeStyle: '#777777',
          lineWidth: 1,
          sharpLines: false,
          millisPerLine: 1000,
          verticalSections: 2,
          borderVisible: true
        },
        labels: {
          fillStyle: '#ffffff',
          disabled: false,
          fontSize: 10,
          fontFamily: 'monospace',
          precision: 2,
          showIntermediateLabels: false,
          intermediateLabelSameAxis: true,
        },
        horizontalLines: [],
        tooltip: false,
        tooltipLine: {
          lineWidth: 1,
          strokeStyle: '#BBBBBB'
        },
        tooltipFormatter: SmoothieChart.tooltipFormatter,
        nonRealtimeData: false,
        responsive: false,
        limitFPS: 0
      };

      // Based on http://inspirit.github.com/jsfeat/js/compatibility.js
      SmoothieChart.AnimateCompatibility = (function() {
        var requestAnimationFrame = function(callback, element) {
              var requestAnimationFrame =
                window.requestAnimationFrame        ||
                window.webkitRequestAnimationFrame  ||
                window.mozRequestAnimationFrame     ||
                window.oRequestAnimationFrame       ||
                window.msRequestAnimationFrame      ||
                function(callback) {
                  return window.setTimeout(function() {
                    callback(Date.now());
                  }, 16);
                };
              return requestAnimationFrame.call(window, callback, element);
            },
            cancelAnimationFrame = function(id) {
              var cancelAnimationFrame =
                window.cancelAnimationFrame ||
                function(id) {
                  clearTimeout(id);
                };
              return cancelAnimationFrame.call(window, id);
            };

        return {
          requestAnimationFrame: requestAnimationFrame,
          cancelAnimationFrame: cancelAnimationFrame
        };
      })();

      SmoothieChart.defaultSeriesPresentationOptions = {
        lineWidth: 1,
        strokeStyle: '#ffffff'
      };

      /**
       * Adds a <code>TimeSeries</code> to this chart, with optional presentation options.
       *
       * Presentation options should be of the form (defaults shown):
       *
       * <pre>
       * {
       *   lineWidth: 1,
       *   strokeStyle: '#ffffff',
       *   fillStyle: undefined
       * }
       * </pre>
       */
      SmoothieChart.prototype.addTimeSeries = function(timeSeries, options) {
        this.seriesSet.push({timeSeries: timeSeries, options: Util.extend({}, SmoothieChart.defaultSeriesPresentationOptions, options)});
        if (timeSeries.options.resetBounds && timeSeries.options.resetBoundsInterval > 0) {
          timeSeries.resetBoundsTimerId = setInterval(
            function() {
              timeSeries.resetBounds();
            },
            timeSeries.options.resetBoundsInterval
          );
        }
      };

      /**
       * Removes the specified <code>TimeSeries</code> from the chart.
       */
      SmoothieChart.prototype.removeTimeSeries = function(timeSeries) {
        // Find the correct timeseries to remove, and remove it
        var numSeries = this.seriesSet.length;
        for (var i = 0; i < numSeries; i++) {
          if (this.seriesSet[i].timeSeries === timeSeries) {
            this.seriesSet.splice(i, 1);
            break;
          }
        }
        // If a timer was operating for that timeseries, remove it
        if (timeSeries.resetBoundsTimerId) {
          // Stop resetting the bounds, if we were
          clearInterval(timeSeries.resetBoundsTimerId);
        }
      };

      /**
       * Gets render options for the specified <code>TimeSeries</code>.
       *
       * As you may use a single <code>TimeSeries</code> in multiple charts with different formatting in each usage,
       * these settings are stored in the chart.
       */
      SmoothieChart.prototype.getTimeSeriesOptions = function(timeSeries) {
        // Find the correct timeseries to remove, and remove it
        var numSeries = this.seriesSet.length;
        for (var i = 0; i < numSeries; i++) {
          if (this.seriesSet[i].timeSeries === timeSeries) {
            return this.seriesSet[i].options;
          }
        }
      };

      /**
       * Brings the specified <code>TimeSeries</code> to the top of the chart. It will be rendered last.
       */
      SmoothieChart.prototype.bringToFront = function(timeSeries) {
        // Find the correct timeseries to remove, and remove it
        var numSeries = this.seriesSet.length;
        for (var i = 0; i < numSeries; i++) {
          if (this.seriesSet[i].timeSeries === timeSeries) {
            var set = this.seriesSet.splice(i, 1);
            this.seriesSet.push(set[0]);
            break;
          }
        }
      };

      /**
       * Instructs the <code>SmoothieChart</code> to start rendering to the provided canvas, with specified delay.
       *
       * @param canvas the target canvas element
       * @param delayMillis an amount of time to wait before a data point is shown. This can prevent the end of the series
       * from appearing on screen, with new values flashing into view, at the expense of some latency.
       */
      SmoothieChart.prototype.streamTo = function(canvas, delayMillis) {
        this.canvas = canvas;
        this.delay = delayMillis;
        this.start();
      };

      SmoothieChart.prototype.getTooltipEl = function () {
        // Create the tool tip element lazily
        if (!this.tooltipEl) {
          this.tooltipEl = document.createElement('div');
          this.tooltipEl.className = 'smoothie-chart-tooltip';
          this.tooltipEl.style.position = 'absolute';
          this.tooltipEl.style.display = 'none';
          document.body.appendChild(this.tooltipEl);
        }
        return this.tooltipEl;
      };

      SmoothieChart.prototype.updateTooltip = function () {
        var el = this.getTooltipEl();

        if (!this.mouseover || !this.options.tooltip) {
          el.style.display = 'none';
          return;
        }

        var time = this.lastChartTimestamp;

        // x pixel to time
        var t = this.options.scrollBackwards
          ? time - this.mouseX * this.options.millisPerPixel
          : time - (this.canvas.offsetWidth - this.mouseX) * this.options.millisPerPixel;

        var data = [];

         // For each data set...
        for (var d = 0; d < this.seriesSet.length; d++) {
          var timeSeries = this.seriesSet[d].timeSeries;
          if (timeSeries.disabled) {
              continue;
          }

          // find datapoint closest to time 't'
          var closeIdx = Util.binarySearch(timeSeries.data, t);
          if (closeIdx > 0 && closeIdx < timeSeries.data.length) {
            data.push({ series: this.seriesSet[d], index: closeIdx, value: timeSeries.data[closeIdx][1] });
          }
        }

        if (data.length) {
          el.innerHTML = this.options.tooltipFormatter.call(this, t, data);
          el.style.display = 'block';
        } else {
          el.style.display = 'none';
        }
      };

      SmoothieChart.prototype.mousemove = function (evt) {
        this.mouseover = true;
        this.mouseX = evt.offsetX;
        this.mouseY = evt.offsetY;
        this.mousePageX = evt.pageX;
        this.mousePageY = evt.pageY;

        var el = this.getTooltipEl();
        el.style.top = Math.round(this.mousePageY) + 'px';
        el.style.left = Math.round(this.mousePageX) + 'px';
        this.updateTooltip();
      };

      SmoothieChart.prototype.mouseout = function () {
        this.mouseover = false;
        this.mouseX = this.mouseY = -1;
        if (this.tooltipEl)
          this.tooltipEl.style.display = 'none';
      };

      /**
       * Make sure the canvas has the optimal resolution for the device's pixel ratio.
       */
      SmoothieChart.prototype.resize = function () {
        var dpr = !this.options.enableDpiScaling || !window ? 1 : window.devicePixelRatio,
            width, height;
        if (this.options.responsive) {
          // Newer behaviour: Use the canvas's size in the layout, and set the internal
          // resolution according to that size and the device pixel ratio (eg: high DPI)
          width = this.canvas.offsetWidth;
          height = this.canvas.offsetHeight;

          if (width !== this.lastWidth) {
            this.lastWidth = width;
            this.canvas.setAttribute('width', (Math.floor(width * dpr)).toString());
            this.canvas.getContext('2d').scale(dpr, dpr);
          }
          if (height !== this.lastHeight) {
            this.lastHeight = height;
            this.canvas.setAttribute('height', (Math.floor(height * dpr)).toString());
            this.canvas.getContext('2d').scale(dpr, dpr);
          }
        } else if (dpr !== 1) {
          // Older behaviour: use the canvas's inner dimensions and scale the element's size
          // according to that size and the device pixel ratio (eg: high DPI)
          width = parseInt(this.canvas.getAttribute('width'));
          height = parseInt(this.canvas.getAttribute('height'));

          if (!this.originalWidth || (Math.floor(this.originalWidth * dpr) !== width)) {
            this.originalWidth = width;
            this.canvas.setAttribute('width', (Math.floor(width * dpr)).toString());
            this.canvas.style.width = width + 'px';
            this.canvas.getContext('2d').scale(dpr, dpr);
          }

          if (!this.originalHeight || (Math.floor(this.originalHeight * dpr) !== height)) {
            this.originalHeight = height;
            this.canvas.setAttribute('height', (Math.floor(height * dpr)).toString());
            this.canvas.style.height = height + 'px';
            this.canvas.getContext('2d').scale(dpr, dpr);
          }
        }
      };

      /**
       * Starts the animation of this chart.
       */
      SmoothieChart.prototype.start = function() {
        if (this.frame) {
          // We're already running, so just return
          return;
        }

        this.canvas.addEventListener('mousemove', this.mousemove);
        this.canvas.addEventListener('mouseout', this.mouseout);

        // Renders a frame, and queues the next frame for later rendering
        var animate = function() {
          this.frame = SmoothieChart.AnimateCompatibility.requestAnimationFrame(function() {
            if(this.options.nonRealtimeData){
               var dateZero = new Date(0);
               // find the data point with the latest timestamp
               var maxTimeStamp = this.seriesSet.reduce(function(max, series){
                 var dataSet = series.timeSeries.data;
                 var indexToCheck = Math.round(this.options.displayDataFromPercentile * dataSet.length) - 1;
                 indexToCheck = indexToCheck >= 0 ? indexToCheck : 0;
                 indexToCheck = indexToCheck <= dataSet.length -1 ? indexToCheck : dataSet.length -1;
                 if(dataSet && dataSet.length > 0)
                 {
                  // timestamp corresponds to element 0 of the data point
                  var lastDataTimeStamp = dataSet[indexToCheck][0];
                  max = max > lastDataTimeStamp ? max : lastDataTimeStamp;
                 }
                 return max;
              }.bind(this), dateZero);
              // use the max timestamp as current time
              this.render(this.canvas, maxTimeStamp > dateZero ? maxTimeStamp : null);
            } else {
              this.render();
            }
            animate();
          }.bind(this));
        }.bind(this);

        animate();
      };

      /**
       * Stops the animation of this chart.
       */
      SmoothieChart.prototype.stop = function() {
        if (this.frame) {
          SmoothieChart.AnimateCompatibility.cancelAnimationFrame(this.frame);
          delete this.frame;
          this.canvas.removeEventListener('mousemove', this.mousemove);
          this.canvas.removeEventListener('mouseout', this.mouseout);
        }
      };

      SmoothieChart.prototype.updateValueRange = function() {
        // Calculate the current scale of the chart, from all time series.
        var chartOptions = this.options,
            chartMaxValue = Number.NaN,
            chartMinValue = Number.NaN;

        for (var d = 0; d < this.seriesSet.length; d++) {
          // TODO(ndunn): We could calculate / track these values as they stream in.
          var timeSeries = this.seriesSet[d].timeSeries;
          if (timeSeries.disabled) {
              continue;
          }

          if (!isNaN(timeSeries.maxValue)) {
            chartMaxValue = !isNaN(chartMaxValue) ? Math.max(chartMaxValue, timeSeries.maxValue) : timeSeries.maxValue;
          }

          if (!isNaN(timeSeries.minValue)) {
            chartMinValue = !isNaN(chartMinValue) ? Math.min(chartMinValue, timeSeries.minValue) : timeSeries.minValue;
          }
        }

        // Scale the chartMaxValue to add padding at the top if required
        if (chartOptions.maxValue != null) {
          chartMaxValue = chartOptions.maxValue;
        } else {
          chartMaxValue *= chartOptions.maxValueScale;
        }

        // Set the minimum if we've specified one
        if (chartOptions.minValue != null) {
          chartMinValue = chartOptions.minValue;
        } else {
          chartMinValue -= Math.abs(chartMinValue * chartOptions.minValueScale - chartMinValue);
        }

        // If a custom range function is set, call it
        if (this.options.yRangeFunction) {
          var range = this.options.yRangeFunction({min: chartMinValue, max: chartMaxValue});
          chartMinValue = range.min;
          chartMaxValue = range.max;
        }

        if (!isNaN(chartMaxValue) && !isNaN(chartMinValue)) {
          var targetValueRange = chartMaxValue - chartMinValue;
          var valueRangeDiff = (targetValueRange - this.currentValueRange);
          var minValueDiff = (chartMinValue - this.currentVisMinValue);
          this.isAnimatingScale = Math.abs(valueRangeDiff) > 0.1 || Math.abs(minValueDiff) > 0.1;
          this.currentValueRange += chartOptions.scaleSmoothing * valueRangeDiff;
          this.currentVisMinValue += chartOptions.scaleSmoothing * minValueDiff;
        }

        this.valueRange = { min: chartMinValue, max: chartMaxValue };
      };

      SmoothieChart.prototype.render = function(canvas, time) {
        var nowMillis = Date.now();

        // Respect any frame rate limit.
        if (this.options.limitFPS > 0 && nowMillis - this.lastRenderTimeMillis < (1000/this.options.limitFPS))
          return;

        if (!this.isAnimatingScale) {
          // We're not animating. We can use the last render time and the scroll speed to work out whether
          // we actually need to paint anything yet. If not, we can return immediately.

          // Render at least every 1/6th of a second. The canvas may be resized, which there is
          // no reliable way to detect.
          var maxIdleMillis = Math.min(1000/6, this.options.millisPerPixel);

          if (nowMillis - this.lastRenderTimeMillis < maxIdleMillis) {
            return;
          }
        }

        this.resize();
        this.updateTooltip();

        this.lastRenderTimeMillis = nowMillis;

        canvas = canvas || this.canvas;
        time = time || nowMillis - (this.delay || 0);

        // Round time down to pixel granularity, so motion appears smoother.
        time -= time % this.options.millisPerPixel;

        this.lastChartTimestamp = time;

        var context = canvas.getContext('2d'),
            chartOptions = this.options,
            dimensions = { top: 0, left: 0, width: canvas.clientWidth, height: canvas.clientHeight },
            // Calculate the threshold time for the oldest data points.
            oldestValidTime = time - (dimensions.width * chartOptions.millisPerPixel),
            valueToYPixel = function(value) {
              var offset = value - this.currentVisMinValue;
              return this.currentValueRange === 0
                ? dimensions.height
                : dimensions.height - (Math.round((offset / this.currentValueRange) * dimensions.height));
            }.bind(this),
            timeToXPixel = function(t) {
              if(chartOptions.scrollBackwards) {
                return Math.round((time - t) / chartOptions.millisPerPixel);
              }
              return Math.round(dimensions.width - ((time - t) / chartOptions.millisPerPixel));
            };

        this.updateValueRange();

        context.font = chartOptions.labels.fontSize + 'px ' + chartOptions.labels.fontFamily;

        // Save the state of the canvas context, any transformations applied in this method
        // will get removed from the stack at the end of this method when .restore() is called.
        context.save();

        // Move the origin.
        context.translate(dimensions.left, dimensions.top);

        // Create a clipped rectangle - anything we draw will be constrained to this rectangle.
        // This prevents the occasional pixels from curves near the edges overrunning and creating
        // screen cheese (that phrase should need no explanation).
        context.beginPath();
        context.rect(0, 0, dimensions.width, dimensions.height);
        context.clip();

        // Clear the working area.
        context.save();
        context.fillStyle = chartOptions.grid.fillStyle;
        context.clearRect(0, 0, dimensions.width, dimensions.height);
        context.fillRect(0, 0, dimensions.width, dimensions.height);
        context.restore();

        // Grid lines...
        context.save();
        context.lineWidth = chartOptions.grid.lineWidth;
        context.strokeStyle = chartOptions.grid.strokeStyle;
        // Vertical (time) dividers.
        if (chartOptions.grid.millisPerLine > 0) {
          context.beginPath();
          for (var t = time - (time % chartOptions.grid.millisPerLine);
               t >= oldestValidTime;
               t -= chartOptions.grid.millisPerLine) {
            var gx = timeToXPixel(t);
            if (chartOptions.grid.sharpLines) {
              gx -= 0.5;
            }
            context.moveTo(gx, 0);
            context.lineTo(gx, dimensions.height);
          }
          context.stroke();
          context.closePath();
        }

        // Horizontal (value) dividers.
        for (var v = 1; v < chartOptions.grid.verticalSections; v++) {
          var gy = Math.round(v * dimensions.height / chartOptions.grid.verticalSections);
          if (chartOptions.grid.sharpLines) {
            gy -= 0.5;
          }
          context.beginPath();
          context.moveTo(0, gy);
          context.lineTo(dimensions.width, gy);
          context.stroke();
          context.closePath();
        }
        // Bounding rectangle.
        if (chartOptions.grid.borderVisible) {
          context.beginPath();
          context.strokeRect(0, 0, dimensions.width, dimensions.height);
          context.closePath();
        }
        context.restore();

        // Draw any horizontal lines...
        if (chartOptions.horizontalLines && chartOptions.horizontalLines.length) {
          for (var hl = 0; hl < chartOptions.horizontalLines.length; hl++) {
            var line = chartOptions.horizontalLines[hl],
                hly = Math.round(valueToYPixel(line.value)) - 0.5;
            context.strokeStyle = line.color || '#ffffff';
            context.lineWidth = line.lineWidth || 1;
            context.beginPath();
            context.moveTo(0, hly);
            context.lineTo(dimensions.width, hly);
            context.stroke();
            context.closePath();
          }
        }

        // For each data set...
        for (var d = 0; d < this.seriesSet.length; d++) {
          context.save();
          var timeSeries = this.seriesSet[d].timeSeries;
          if (timeSeries.disabled) {
              continue;
          }

          var dataSet = timeSeries.data,
              seriesOptions = this.seriesSet[d].options;

          // Delete old data that's moved off the left of the chart.
          timeSeries.dropOldData(oldestValidTime, chartOptions.maxDataSetLength);

          // Set style for this dataSet.
          context.lineWidth = seriesOptions.lineWidth;
          context.strokeStyle = seriesOptions.strokeStyle;
          // Draw the line...
          context.beginPath();
          // Retain lastX, lastY for calculating the control points of bezier curves.
          var firstX = 0, lastX = 0, lastY = 0;
          for (var i = 0; i < dataSet.length && dataSet.length !== 1; i++) {
            var x = timeToXPixel(dataSet[i][0]),
                y = valueToYPixel(dataSet[i][1]);

            if (i === 0) {
              firstX = x;
              context.moveTo(x, y);
            } else {
              switch (chartOptions.interpolation) {
                case "linear":
                case "line": {
                  context.lineTo(x,y);
                  break;
                }
                case "bezier":
                default: {
                  // Great explanation of Bezier curves: http://en.wikipedia.org/wiki/Bezier_curve#Quadratic_curves
                  //
                  // Assuming A was the last point in the line plotted and B is the new point,
                  // we draw a curve with control points P and Q as below.
                  //
                  // A---P
                  //     |
                  //     |
                  //     |
                  //     Q---B
                  //
                  // Importantly, A and P are at the same y coordinate, as are B and Q. This is
                  // so adjacent curves appear to flow as one.
                  //
                  context.bezierCurveTo( // startPoint (A) is implicit from last iteration of loop
                    Math.round((lastX + x) / 2), lastY, // controlPoint1 (P)
                    Math.round((lastX + x)) / 2, y, // controlPoint2 (Q)
                    x, y); // endPoint (B)
                  break;
                }
                case "step": {
                  context.lineTo(x,lastY);
                  context.lineTo(x,y);
                  break;
                }
              }
            }

            lastX = x; lastY = y;
          }

          if (dataSet.length > 1) {
            if (seriesOptions.fillStyle) {
              // Close up the fill region.
              context.lineTo(dimensions.width + seriesOptions.lineWidth + 1, lastY);
              context.lineTo(dimensions.width + seriesOptions.lineWidth + 1, dimensions.height + seriesOptions.lineWidth + 1);
              context.lineTo(firstX, dimensions.height + seriesOptions.lineWidth);
              context.fillStyle = seriesOptions.fillStyle;
              context.fill();
            }

            if (seriesOptions.strokeStyle && seriesOptions.strokeStyle !== 'none') {
              context.stroke();
            }
            context.closePath();
          }
          context.restore();
        }

        if (chartOptions.tooltip && this.mouseX >= 0) {
          // Draw vertical bar to show tooltip position
          context.lineWidth = chartOptions.tooltipLine.lineWidth;
          context.strokeStyle = chartOptions.tooltipLine.strokeStyle;
          context.beginPath();
          context.moveTo(this.mouseX, 0);
          context.lineTo(this.mouseX, dimensions.height);
          context.closePath();
          context.stroke();
          this.updateTooltip();
        }

        // Draw the axis values on the chart.
        if (!chartOptions.labels.disabled && !isNaN(this.valueRange.min) && !isNaN(this.valueRange.max)) {
          var maxValueString = chartOptions.yMaxFormatter(this.valueRange.max, chartOptions.labels.precision),
              minValueString = chartOptions.yMinFormatter(this.valueRange.min, chartOptions.labels.precision),
              maxLabelPos = chartOptions.scrollBackwards ? 0 : dimensions.width - context.measureText(maxValueString).width - 2,
              minLabelPos = chartOptions.scrollBackwards ? 0 : dimensions.width - context.measureText(minValueString).width - 2;
          context.fillStyle = chartOptions.labels.fillStyle;
          context.fillText(maxValueString, maxLabelPos, chartOptions.labels.fontSize);
          context.fillText(minValueString, minLabelPos, dimensions.height - 2);
        }

        // Display intermediate y axis labels along y-axis to the left of the chart
        if ( chartOptions.labels.showIntermediateLabels
              && !isNaN(this.valueRange.min) && !isNaN(this.valueRange.max)
              && chartOptions.grid.verticalSections > 0) {
          // show a label above every vertical section divider
          var step = (this.valueRange.max - this.valueRange.min) / chartOptions.grid.verticalSections;
          var stepPixels = dimensions.height / chartOptions.grid.verticalSections;
          for (var v = 1; v < chartOptions.grid.verticalSections; v++) {
            var gy = dimensions.height - Math.round(v * stepPixels);
            if (chartOptions.grid.sharpLines) {
              gy -= 0.5;
            }
            var yValue = chartOptions.yIntermediateFormatter(this.valueRange.min + (v * step), chartOptions.labels.precision);
            //left of right axis?
            intermediateLabelPos =
              chartOptions.labels.intermediateLabelSameAxis
              ? (chartOptions.scrollBackwards ? 0 : dimensions.width - context.measureText(yValue).width - 2)
              : (chartOptions.scrollBackwards ? dimensions.width - context.measureText(yValue).width - 2 : 0);

            context.fillText(yValue, intermediateLabelPos, gy - chartOptions.grid.lineWidth);
          }
        }

        // Display timestamps along x-axis at the bottom of the chart.
        if (chartOptions.timestampFormatter && chartOptions.grid.millisPerLine > 0) {
          var textUntilX = chartOptions.scrollBackwards
            ? context.measureText(minValueString).width
            : dimensions.width - context.measureText(minValueString).width + 4;
          for (var t = time - (time % chartOptions.grid.millisPerLine);
               t >= oldestValidTime;
               t -= chartOptions.grid.millisPerLine) {
            var gx = timeToXPixel(t);
            // Only draw the timestamp if it won't overlap with the previously drawn one.
            if ((!chartOptions.scrollBackwards && gx < textUntilX) || (chartOptions.scrollBackwards && gx > textUntilX))  {
              // Formats the timestamp based on user specified formatting function
              // SmoothieChart.timeFormatter function above is one such formatting option
              var tx = new Date(t),
                ts = chartOptions.timestampFormatter(tx),
                tsWidth = context.measureText(ts).width;

              textUntilX = chartOptions.scrollBackwards
                ? gx + tsWidth + 2
                : gx - tsWidth - 2;

              context.fillStyle = chartOptions.labels.fillStyle;
              if(chartOptions.scrollBackwards) {
                context.fillText(ts, gx, dimensions.height - 2);
              } else {
                context.fillText(ts, gx - tsWidth, dimensions.height - 2);
              }
            }
          }
        }

        context.restore(); // See .save() above.
      };

      // Sample timestamp formatting function
      SmoothieChart.timeFormatter = function(date) {
        function pad2(number) { return (number < 10 ? '0' : '') + number }
        return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
      };

      exports.TimeSeries = TimeSeries;
      exports.SmoothieChart = SmoothieChart;

    })( exports);
    });

    /* src/chart.svelte generated by Svelte v3.19.2 */
    const file$2 = "src/chart.svelte";

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[0] = list[i];
    	child_ctx[17] = i;
    	return child_ctx;
    }

    // (131:6) {#each CHART_SPEEDS as speed, i}
    function create_each_block(ctx) {
    	let option;
    	let t_value = /*speed*/ ctx[0].name + "";
    	let t;
    	let option_value_value;

    	const block = {
    		c: function create() {
    			option = element("option");
    			t = text(t_value);
    			option.__value = option_value_value = /*i*/ ctx[17];
    			option.value = option.__value;
    			add_location(option, file$2, 131, 8, 2869);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, option, anchor);
    			append_dev(option, t);
    		},
    		p: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(option);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block.name,
    		type: "each",
    		source: "(131:6) {#each CHART_SPEEDS as speed, i}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$2(ctx) {
    	let div1;
    	let canvas;
    	let graph_action;
    	let t;
    	let div0;
    	let select;
    	let dispose;
    	let each_value = /*CHART_SPEEDS*/ ctx[1];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	const block = {
    		c: function create() {
    			div1 = element("div");
    			canvas = element("canvas");
    			t = space();
    			div0 = element("div");
    			select = element("select");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr_dev(canvas, "height", "250");
    			attr_dev(canvas, "width", "400");
    			attr_dev(canvas, "class", "svelte-1u8coo0");
    			add_location(canvas, file$2, 127, 2, 2712);
    			if (/*speed*/ ctx[0] === void 0) add_render_callback(() => /*select_change_handler*/ ctx[15].call(select));
    			add_location(select, file$2, 129, 4, 2794);
    			attr_dev(div0, "class", "select is-small svelte-1u8coo0");
    			add_location(div0, file$2, 128, 2, 2760);
    			attr_dev(div1, "class", "graph-pane svelte-1u8coo0");
    			add_location(div1, file$2, 126, 0, 2685);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div1, anchor);
    			append_dev(div1, canvas);
    			append_dev(div1, t);
    			append_dev(div1, div0);
    			append_dev(div0, select);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(select, null);
    			}

    			select_option(select, /*speed*/ ctx[0]);

    			dispose = [
    				action_destroyer(graph_action = /*graph*/ ctx[2].call(null, canvas)),
    				listen_dev(select, "change", /*select_change_handler*/ ctx[15])
    			];
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*CHART_SPEEDS*/ 2) {
    				each_value = /*CHART_SPEEDS*/ ctx[1];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(select, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (dirty & /*speed*/ 1) {
    				select_option(select, /*speed*/ ctx[0]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div1);
    			destroy_each(each_blocks, detaching);
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$2.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$2($$self, $$props, $$invalidate) {
    	const CHART_SPEEDS = [
    		{ name: "Slow", value: 333 },
    		{ name: "Moderate", value: 100 },
    		{ name: "Normal", value: 50 },
    		{ name: "Quick", value: 25 },
    		{ name: "Fast", value: 10 },
    		{ name: "Brief", value: 5 }
    	];

    	const CHART_COLORS = [
    		"#ff3860",
    		"#22d15f",
    		"#1f9cee",
    		"#f5f5f5",
    		"#ffdd56",
    		"#ea80fc",
    		"#ff5722",
    		"#69f0ae",
    		"#b388ff",
    		"#76ff03"
    	];

    	let speed = 2;
    	let decoder = new TextDecoder("utf-8");
    	let accumulator = "";
    	const { TimeSeries, SmoothieChart } = smoothie;

    	const chart = new SmoothieChart({
    			millisPerPixel: CHART_SPEEDS[speed].value,
    			limitFPS: 40,
    			tooltip: true,
    			grid: {
    				strokeStyle: "#202020",
    				borderVisible: false,
    				millisPerLine: CHART_SPEEDS[speed].value * 100,
    				verticalSections: 4,
    				sharpLines: true
    			}
    		});

    	const series = [];

    	for (let index = 0; index < 10; index++) {
    		const ds = new TimeSeries();
    		series.push(ds);

    		chart.addTimeSeries(ds, {
    			strokeStyle: CHART_COLORS[index],
    			lineWidth: 2
    		});
    	}

    	function clear() {
    		for (const ds of series) {
    			ds.clear();
    		}

    		decoder = new TextDecoder("utf-8");
    		accumulator = "";
    	}

    	function pushData(buffer) {
    		accumulator += decoder.decode(buffer, { stream: true });
    		extractPoints();
    	}

    	function pushPoints(index, point) {
    		const ds = series[index];
    		ds && ds.append(Date.now(), point);
    	}

    	function* readLine() {
    		while (true) {
    			const index = accumulator.indexOf("\n");

    			if (index < 0) {
    				return;
    			}

    			yield accumulator.slice(0, index + 1);
    			accumulator = accumulator.slice(index + 1);
    		}
    	}

    	function extractPoints() {
    		for (const line of readLine()) {
    			const points = line.split(/[^.\w]/).map(parseFloat).filter(Boolean);

    			for (let index = 0; index < points.length; index++) {
    				pushPoints(index, points[index]);
    			}
    		}
    	}

    	function graph(node) {
    		chart.streamTo(node, 300);
    		node.width = node.parentElement.clientWidth;
    	}

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<Chart> was created with unknown prop '${key}'`);
    	});

    	let { $$slots = {}, $$scope } = $$props;
    	validate_slots("Chart", $$slots, []);

    	function select_change_handler() {
    		speed = select_value(this);
    		$$invalidate(0, speed);
    	}

    	$$self.$capture_state = () => ({
    		Smoothie: smoothie,
    		CHART_SPEEDS,
    		CHART_COLORS,
    		speed,
    		decoder,
    		accumulator,
    		TimeSeries,
    		SmoothieChart,
    		chart,
    		series,
    		clear,
    		pushData,
    		pushPoints,
    		readLine,
    		extractPoints,
    		graph
    	});

    	$$self.$inject_state = $$props => {
    		if ("speed" in $$props) $$invalidate(0, speed = $$props.speed);
    		if ("decoder" in $$props) decoder = $$props.decoder;
    		if ("accumulator" in $$props) accumulator = $$props.accumulator;
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*speed*/ 1) {
    			 {
    				chart.options.grid.millisPerLine = CHART_SPEEDS[speed].value * 100;
    				chart.options.millisPerPixel = CHART_SPEEDS[speed].value;
    			}
    		}
    	};

    	return [
    		speed,
    		CHART_SPEEDS,
    		graph,
    		clear,
    		pushData,
    		decoder,
    		accumulator,
    		chart,
    		CHART_COLORS,
    		TimeSeries,
    		SmoothieChart,
    		series,
    		pushPoints,
    		readLine,
    		extractPoints,
    		select_change_handler
    	];
    }

    class Chart extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, { clear: 3, pushData: 4 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Chart",
    			options,
    			id: create_fragment$2.name
    		});
    	}

    	get clear() {
    		return this.$$.ctx[3];
    	}

    	set clear(value) {
    		throw new Error("<Chart>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get pushData() {
    		return this.$$.ctx[4];
    	}

    	set pushData(value) {
    		throw new Error("<Chart>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

    function createCommonjsModule$1(fn, module) {
    	return module = { exports: {} }, fn(module, module.exports), module.exports;
    }

    var check = function (it) {
      return it && it.Math == Math && it;
    };

    // https://github.com/zloirock/core-js/issues/86#issuecomment-115759028
    var global_1 =
      // eslint-disable-next-line no-undef
      check(typeof globalThis == 'object' && globalThis) ||
      check(typeof window == 'object' && window) ||
      check(typeof self == 'object' && self) ||
      check(typeof commonjsGlobal == 'object' && commonjsGlobal) ||
      // eslint-disable-next-line no-new-func
      Function('return this')();

    var fails = function (exec) {
      try {
        return !!exec();
      } catch (error) {
        return true;
      }
    };

    // Thank's IE8 for his funny defineProperty
    var descriptors = !fails(function () {
      return Object.defineProperty({}, 'a', { get: function () { return 7; } }).a != 7;
    });

    var nativePropertyIsEnumerable = {}.propertyIsEnumerable;
    var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

    // Nashorn ~ JDK8 bug
    var NASHORN_BUG = getOwnPropertyDescriptor && !nativePropertyIsEnumerable.call({ 1: 2 }, 1);

    // `Object.prototype.propertyIsEnumerable` method implementation
    // https://tc39.github.io/ecma262/#sec-object.prototype.propertyisenumerable
    var f = NASHORN_BUG ? function propertyIsEnumerable(V) {
      var descriptor = getOwnPropertyDescriptor(this, V);
      return !!descriptor && descriptor.enumerable;
    } : nativePropertyIsEnumerable;

    var objectPropertyIsEnumerable = {
    	f: f
    };

    var createPropertyDescriptor = function (bitmap, value) {
      return {
        enumerable: !(bitmap & 1),
        configurable: !(bitmap & 2),
        writable: !(bitmap & 4),
        value: value
      };
    };

    var toString = {}.toString;

    var classofRaw = function (it) {
      return toString.call(it).slice(8, -1);
    };

    var split = ''.split;

    // fallback for non-array-like ES3 and non-enumerable old V8 strings
    var indexedObject = fails(function () {
      // throws an error in rhino, see https://github.com/mozilla/rhino/issues/346
      // eslint-disable-next-line no-prototype-builtins
      return !Object('z').propertyIsEnumerable(0);
    }) ? function (it) {
      return classofRaw(it) == 'String' ? split.call(it, '') : Object(it);
    } : Object;

    // `RequireObjectCoercible` abstract operation
    // https://tc39.github.io/ecma262/#sec-requireobjectcoercible
    var requireObjectCoercible = function (it) {
      if (it == undefined) throw TypeError("Can't call method on " + it);
      return it;
    };

    // toObject with fallback for non-array-like ES3 strings



    var toIndexedObject = function (it) {
      return indexedObject(requireObjectCoercible(it));
    };

    var isObject = function (it) {
      return typeof it === 'object' ? it !== null : typeof it === 'function';
    };

    // `ToPrimitive` abstract operation
    // https://tc39.github.io/ecma262/#sec-toprimitive
    // instead of the ES6 spec version, we didn't implement @@toPrimitive case
    // and the second argument - flag - preferred type is a string
    var toPrimitive = function (input, PREFERRED_STRING) {
      if (!isObject(input)) return input;
      var fn, val;
      if (PREFERRED_STRING && typeof (fn = input.toString) == 'function' && !isObject(val = fn.call(input))) return val;
      if (typeof (fn = input.valueOf) == 'function' && !isObject(val = fn.call(input))) return val;
      if (!PREFERRED_STRING && typeof (fn = input.toString) == 'function' && !isObject(val = fn.call(input))) return val;
      throw TypeError("Can't convert object to primitive value");
    };

    var hasOwnProperty = {}.hasOwnProperty;

    var has = function (it, key) {
      return hasOwnProperty.call(it, key);
    };

    var document$1 = global_1.document;
    // typeof document.createElement is 'object' in old IE
    var EXISTS = isObject(document$1) && isObject(document$1.createElement);

    var documentCreateElement = function (it) {
      return EXISTS ? document$1.createElement(it) : {};
    };

    // Thank's IE8 for his funny defineProperty
    var ie8DomDefine = !descriptors && !fails(function () {
      return Object.defineProperty(documentCreateElement('div'), 'a', {
        get: function () { return 7; }
      }).a != 7;
    });

    var nativeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

    // `Object.getOwnPropertyDescriptor` method
    // https://tc39.github.io/ecma262/#sec-object.getownpropertydescriptor
    var f$1 = descriptors ? nativeGetOwnPropertyDescriptor : function getOwnPropertyDescriptor(O, P) {
      O = toIndexedObject(O);
      P = toPrimitive(P, true);
      if (ie8DomDefine) try {
        return nativeGetOwnPropertyDescriptor(O, P);
      } catch (error) { /* empty */ }
      if (has(O, P)) return createPropertyDescriptor(!objectPropertyIsEnumerable.f.call(O, P), O[P]);
    };

    var objectGetOwnPropertyDescriptor = {
    	f: f$1
    };

    var anObject = function (it) {
      if (!isObject(it)) {
        throw TypeError(String(it) + ' is not an object');
      } return it;
    };

    var nativeDefineProperty = Object.defineProperty;

    // `Object.defineProperty` method
    // https://tc39.github.io/ecma262/#sec-object.defineproperty
    var f$2 = descriptors ? nativeDefineProperty : function defineProperty(O, P, Attributes) {
      anObject(O);
      P = toPrimitive(P, true);
      anObject(Attributes);
      if (ie8DomDefine) try {
        return nativeDefineProperty(O, P, Attributes);
      } catch (error) { /* empty */ }
      if ('get' in Attributes || 'set' in Attributes) throw TypeError('Accessors not supported');
      if ('value' in Attributes) O[P] = Attributes.value;
      return O;
    };

    var objectDefineProperty = {
    	f: f$2
    };

    var createNonEnumerableProperty = descriptors ? function (object, key, value) {
      return objectDefineProperty.f(object, key, createPropertyDescriptor(1, value));
    } : function (object, key, value) {
      object[key] = value;
      return object;
    };

    var setGlobal = function (key, value) {
      try {
        createNonEnumerableProperty(global_1, key, value);
      } catch (error) {
        global_1[key] = value;
      } return value;
    };

    var SHARED = '__core-js_shared__';
    var store = global_1[SHARED] || setGlobal(SHARED, {});

    var sharedStore = store;

    var shared = createCommonjsModule$1(function (module) {
    (module.exports = function (key, value) {
      return sharedStore[key] || (sharedStore[key] = value !== undefined ? value : {});
    })('versions', []).push({
      version: '3.3.6',
      mode:  'global',
      copyright: '© 2019 Denis Pushkarev (zloirock.ru)'
    });
    });

    var functionToString = shared('native-function-to-string', Function.toString);

    var WeakMap = global_1.WeakMap;

    var nativeWeakMap = typeof WeakMap === 'function' && /native code/.test(functionToString.call(WeakMap));

    var id = 0;
    var postfix = Math.random();

    var uid = function (key) {
      return 'Symbol(' + String(key === undefined ? '' : key) + ')_' + (++id + postfix).toString(36);
    };

    var keys = shared('keys');

    var sharedKey = function (key) {
      return keys[key] || (keys[key] = uid(key));
    };

    var hiddenKeys = {};

    var WeakMap$1 = global_1.WeakMap;
    var set, get, has$1;

    var enforce = function (it) {
      return has$1(it) ? get(it) : set(it, {});
    };

    var getterFor = function (TYPE) {
      return function (it) {
        var state;
        if (!isObject(it) || (state = get(it)).type !== TYPE) {
          throw TypeError('Incompatible receiver, ' + TYPE + ' required');
        } return state;
      };
    };

    if (nativeWeakMap) {
      var store$1 = new WeakMap$1();
      var wmget = store$1.get;
      var wmhas = store$1.has;
      var wmset = store$1.set;
      set = function (it, metadata) {
        wmset.call(store$1, it, metadata);
        return metadata;
      };
      get = function (it) {
        return wmget.call(store$1, it) || {};
      };
      has$1 = function (it) {
        return wmhas.call(store$1, it);
      };
    } else {
      var STATE = sharedKey('state');
      hiddenKeys[STATE] = true;
      set = function (it, metadata) {
        createNonEnumerableProperty(it, STATE, metadata);
        return metadata;
      };
      get = function (it) {
        return has(it, STATE) ? it[STATE] : {};
      };
      has$1 = function (it) {
        return has(it, STATE);
      };
    }

    var internalState = {
      set: set,
      get: get,
      has: has$1,
      enforce: enforce,
      getterFor: getterFor
    };

    var redefine = createCommonjsModule$1(function (module) {
    var getInternalState = internalState.get;
    var enforceInternalState = internalState.enforce;
    var TEMPLATE = String(functionToString).split('toString');

    shared('inspectSource', function (it) {
      return functionToString.call(it);
    });

    (module.exports = function (O, key, value, options) {
      var unsafe = options ? !!options.unsafe : false;
      var simple = options ? !!options.enumerable : false;
      var noTargetGet = options ? !!options.noTargetGet : false;
      if (typeof value == 'function') {
        if (typeof key == 'string' && !has(value, 'name')) createNonEnumerableProperty(value, 'name', key);
        enforceInternalState(value).source = TEMPLATE.join(typeof key == 'string' ? key : '');
      }
      if (O === global_1) {
        if (simple) O[key] = value;
        else setGlobal(key, value);
        return;
      } else if (!unsafe) {
        delete O[key];
      } else if (!noTargetGet && O[key]) {
        simple = true;
      }
      if (simple) O[key] = value;
      else createNonEnumerableProperty(O, key, value);
    // add fake Function#toString for correct work wrapped methods / constructors with methods like LoDash isNative
    })(Function.prototype, 'toString', function toString() {
      return typeof this == 'function' && getInternalState(this).source || functionToString.call(this);
    });
    });

    var path = global_1;

    var aFunction = function (variable) {
      return typeof variable == 'function' ? variable : undefined;
    };

    var getBuiltIn = function (namespace, method) {
      return arguments.length < 2 ? aFunction(path[namespace]) || aFunction(global_1[namespace])
        : path[namespace] && path[namespace][method] || global_1[namespace] && global_1[namespace][method];
    };

    var ceil = Math.ceil;
    var floor = Math.floor;

    // `ToInteger` abstract operation
    // https://tc39.github.io/ecma262/#sec-tointeger
    var toInteger = function (argument) {
      return isNaN(argument = +argument) ? 0 : (argument > 0 ? floor : ceil)(argument);
    };

    var min = Math.min;

    // `ToLength` abstract operation
    // https://tc39.github.io/ecma262/#sec-tolength
    var toLength = function (argument) {
      return argument > 0 ? min(toInteger(argument), 0x1FFFFFFFFFFFFF) : 0; // 2 ** 53 - 1 == 9007199254740991
    };

    var max = Math.max;
    var min$1 = Math.min;

    // Helper for a popular repeating case of the spec:
    // Let integer be ? ToInteger(index).
    // If integer < 0, let result be max((length + integer), 0); else let result be min(length, length).
    var toAbsoluteIndex = function (index, length) {
      var integer = toInteger(index);
      return integer < 0 ? max(integer + length, 0) : min$1(integer, length);
    };

    // `Array.prototype.{ indexOf, includes }` methods implementation
    var createMethod = function (IS_INCLUDES) {
      return function ($this, el, fromIndex) {
        var O = toIndexedObject($this);
        var length = toLength(O.length);
        var index = toAbsoluteIndex(fromIndex, length);
        var value;
        // Array#includes uses SameValueZero equality algorithm
        // eslint-disable-next-line no-self-compare
        if (IS_INCLUDES && el != el) while (length > index) {
          value = O[index++];
          // eslint-disable-next-line no-self-compare
          if (value != value) return true;
        // Array#indexOf ignores holes, Array#includes - not
        } else for (;length > index; index++) {
          if ((IS_INCLUDES || index in O) && O[index] === el) return IS_INCLUDES || index || 0;
        } return !IS_INCLUDES && -1;
      };
    };

    var arrayIncludes = {
      // `Array.prototype.includes` method
      // https://tc39.github.io/ecma262/#sec-array.prototype.includes
      includes: createMethod(true),
      // `Array.prototype.indexOf` method
      // https://tc39.github.io/ecma262/#sec-array.prototype.indexof
      indexOf: createMethod(false)
    };

    var indexOf = arrayIncludes.indexOf;


    var objectKeysInternal = function (object, names) {
      var O = toIndexedObject(object);
      var i = 0;
      var result = [];
      var key;
      for (key in O) !has(hiddenKeys, key) && has(O, key) && result.push(key);
      // Don't enum bug & hidden keys
      while (names.length > i) if (has(O, key = names[i++])) {
        ~indexOf(result, key) || result.push(key);
      }
      return result;
    };

    // IE8- don't enum bug keys
    var enumBugKeys = [
      'constructor',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'toLocaleString',
      'toString',
      'valueOf'
    ];

    var hiddenKeys$1 = enumBugKeys.concat('length', 'prototype');

    // `Object.getOwnPropertyNames` method
    // https://tc39.github.io/ecma262/#sec-object.getownpropertynames
    var f$3 = Object.getOwnPropertyNames || function getOwnPropertyNames(O) {
      return objectKeysInternal(O, hiddenKeys$1);
    };

    var objectGetOwnPropertyNames = {
    	f: f$3
    };

    var f$4 = Object.getOwnPropertySymbols;

    var objectGetOwnPropertySymbols = {
    	f: f$4
    };

    // all object keys, includes non-enumerable and symbols
    var ownKeys = getBuiltIn('Reflect', 'ownKeys') || function ownKeys(it) {
      var keys = objectGetOwnPropertyNames.f(anObject(it));
      var getOwnPropertySymbols = objectGetOwnPropertySymbols.f;
      return getOwnPropertySymbols ? keys.concat(getOwnPropertySymbols(it)) : keys;
    };

    var copyConstructorProperties = function (target, source) {
      var keys = ownKeys(source);
      var defineProperty = objectDefineProperty.f;
      var getOwnPropertyDescriptor = objectGetOwnPropertyDescriptor.f;
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (!has(target, key)) defineProperty(target, key, getOwnPropertyDescriptor(source, key));
      }
    };

    var replacement = /#|\.prototype\./;

    var isForced = function (feature, detection) {
      var value = data[normalize(feature)];
      return value == POLYFILL ? true
        : value == NATIVE ? false
        : typeof detection == 'function' ? fails(detection)
        : !!detection;
    };

    var normalize = isForced.normalize = function (string) {
      return String(string).replace(replacement, '.').toLowerCase();
    };

    var data = isForced.data = {};
    var NATIVE = isForced.NATIVE = 'N';
    var POLYFILL = isForced.POLYFILL = 'P';

    var isForced_1 = isForced;

    var getOwnPropertyDescriptor$1 = objectGetOwnPropertyDescriptor.f;






    /*
      options.target      - name of the target object
      options.global      - target is the global object
      options.stat        - export as static methods of target
      options.proto       - export as prototype methods of target
      options.real        - real prototype method for the `pure` version
      options.forced      - export even if the native feature is available
      options.bind        - bind methods to the target, required for the `pure` version
      options.wrap        - wrap constructors to preventing global pollution, required for the `pure` version
      options.unsafe      - use the simple assignment of property instead of delete + defineProperty
      options.sham        - add a flag to not completely full polyfills
      options.enumerable  - export as enumerable property
      options.noTargetGet - prevent calling a getter on target
    */
    var _export = function (options, source) {
      var TARGET = options.target;
      var GLOBAL = options.global;
      var STATIC = options.stat;
      var FORCED, target, key, targetProperty, sourceProperty, descriptor;
      if (GLOBAL) {
        target = global_1;
      } else if (STATIC) {
        target = global_1[TARGET] || setGlobal(TARGET, {});
      } else {
        target = (global_1[TARGET] || {}).prototype;
      }
      if (target) for (key in source) {
        sourceProperty = source[key];
        if (options.noTargetGet) {
          descriptor = getOwnPropertyDescriptor$1(target, key);
          targetProperty = descriptor && descriptor.value;
        } else targetProperty = target[key];
        FORCED = isForced_1(GLOBAL ? key : TARGET + (STATIC ? '.' : '#') + key, options.forced);
        // contained in target
        if (!FORCED && targetProperty !== undefined) {
          if (typeof sourceProperty === typeof targetProperty) continue;
          copyConstructorProperties(sourceProperty, targetProperty);
        }
        // add a flag to not completely full polyfills
        if (options.sham || (targetProperty && targetProperty.sham)) {
          createNonEnumerableProperty(sourceProperty, 'sham', true);
        }
        // extend global
        redefine(target, key, sourceProperty, options);
      }
    };

    // `IsArray` abstract operation
    // https://tc39.github.io/ecma262/#sec-isarray
    var isArray = Array.isArray || function isArray(arg) {
      return classofRaw(arg) == 'Array';
    };

    var createProperty = function (object, key, value) {
      var propertyKey = toPrimitive(key);
      if (propertyKey in object) objectDefineProperty.f(object, propertyKey, createPropertyDescriptor(0, value));
      else object[propertyKey] = value;
    };

    var nativeSymbol = !!Object.getOwnPropertySymbols && !fails(function () {
      // Chrome 38 Symbol has incorrect toString conversion
      // eslint-disable-next-line no-undef
      return !String(Symbol());
    });

    var Symbol$1 = global_1.Symbol;
    var store$2 = shared('wks');

    var wellKnownSymbol = function (name) {
      return store$2[name] || (store$2[name] = nativeSymbol && Symbol$1[name]
        || (nativeSymbol ? Symbol$1 : uid)('Symbol.' + name));
    };

    var userAgent = getBuiltIn('navigator', 'userAgent') || '';

    var process = global_1.process;
    var versions = process && process.versions;
    var v8 = versions && versions.v8;
    var match, version;

    if (v8) {
      match = v8.split('.');
      version = match[0] + match[1];
    } else if (userAgent) {
      match = userAgent.match(/Edge\/(\d+)/);
      if (!match || match[1] >= 74) {
        match = userAgent.match(/Chrome\/(\d+)/);
        if (match) version = match[1];
      }
    }

    var v8Version = version && +version;

    var SPECIES = wellKnownSymbol('species');

    var arrayMethodHasSpeciesSupport = function (METHOD_NAME) {
      // We can't use this feature detection in V8 since it causes
      // deoptimization and serious performance degradation
      // https://github.com/zloirock/core-js/issues/677
      return v8Version >= 51 || !fails(function () {
        var array = [];
        var constructor = array.constructor = {};
        constructor[SPECIES] = function () {
          return { foo: 1 };
        };
        return array[METHOD_NAME](Boolean).foo !== 1;
      });
    };

    var SPECIES$1 = wellKnownSymbol('species');
    var nativeSlice = [].slice;
    var max$1 = Math.max;

    // `Array.prototype.slice` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.slice
    // fallback for not array-like ES3 strings and DOM objects
    _export({ target: 'Array', proto: true, forced: !arrayMethodHasSpeciesSupport('slice') }, {
      slice: function slice(start, end) {
        var O = toIndexedObject(this);
        var length = toLength(O.length);
        var k = toAbsoluteIndex(start, length);
        var fin = toAbsoluteIndex(end === undefined ? length : end, length);
        // inline `ArraySpeciesCreate` for usage native `Array#slice` where it's possible
        var Constructor, result, n;
        if (isArray(O)) {
          Constructor = O.constructor;
          // cross-realm fallback
          if (typeof Constructor == 'function' && (Constructor === Array || isArray(Constructor.prototype))) {
            Constructor = undefined;
          } else if (isObject(Constructor)) {
            Constructor = Constructor[SPECIES$1];
            if (Constructor === null) Constructor = undefined;
          }
          if (Constructor === Array || Constructor === undefined) {
            return nativeSlice.call(O, k, fin);
          }
        }
        result = new (Constructor === undefined ? Array : Constructor)(max$1(fin - k, 0));
        for (n = 0; k < fin; k++, n++) if (k in O) createProperty(result, n, O[k]);
        result.length = n;
        return result;
      }
    });

    var defineProperty = objectDefineProperty.f;

    var FunctionPrototype = Function.prototype;
    var FunctionPrototypeToString = FunctionPrototype.toString;
    var nameRE = /^\s*function ([^ (]*)/;
    var NAME = 'name';

    // Function instances `.name` property
    // https://tc39.github.io/ecma262/#sec-function-instances-name
    if (descriptors && !(NAME in FunctionPrototype)) {
      defineProperty(FunctionPrototype, NAME, {
        configurable: true,
        get: function () {
          try {
            return FunctionPrototypeToString.call(this).match(nameRE)[1];
          } catch (error) {
            return '';
          }
        }
      });
    }

    var nativeGetOwnPropertyNames = objectGetOwnPropertyNames.f;

    var toString$1 = {}.toString;

    var windowNames = typeof window == 'object' && window && Object.getOwnPropertyNames
      ? Object.getOwnPropertyNames(window) : [];

    var getWindowNames = function (it) {
      try {
        return nativeGetOwnPropertyNames(it);
      } catch (error) {
        return windowNames.slice();
      }
    };

    // fallback for IE11 buggy Object.getOwnPropertyNames with iframe and window
    var f$5 = function getOwnPropertyNames(it) {
      return windowNames && toString$1.call(it) == '[object Window]'
        ? getWindowNames(it)
        : nativeGetOwnPropertyNames(toIndexedObject(it));
    };

    var objectGetOwnPropertyNamesExternal = {
    	f: f$5
    };

    var nativeGetOwnPropertyNames$1 = objectGetOwnPropertyNamesExternal.f;

    var FAILS_ON_PRIMITIVES = fails(function () { return !Object.getOwnPropertyNames(1); });

    // `Object.getOwnPropertyNames` method
    // https://tc39.github.io/ecma262/#sec-object.getownpropertynames
    _export({ target: 'Object', stat: true, forced: FAILS_ON_PRIMITIVES }, {
      getOwnPropertyNames: nativeGetOwnPropertyNames$1
    });

    function _typeof2(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof2 = function _typeof2(obj) { return typeof obj; }; } else { _typeof2 = function _typeof2(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof2(obj); }

    function _typeof(obj) {
      if (typeof Symbol === "function" && _typeof2(Symbol.iterator) === "symbol") {
        _typeof = function _typeof(obj) {
          return _typeof2(obj);
        };
      } else {
        _typeof = function _typeof(obj) {
          return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : _typeof2(obj);
        };
      }

      return _typeof(obj);
    }

    // `ToObject` abstract operation
    // https://tc39.github.io/ecma262/#sec-toobject
    var toObject = function (argument) {
      return Object(requireObjectCoercible(argument));
    };

    // `Object.keys` method
    // https://tc39.github.io/ecma262/#sec-object.keys
    var objectKeys = Object.keys || function keys(O) {
      return objectKeysInternal(O, enumBugKeys);
    };

    // `Object.defineProperties` method
    // https://tc39.github.io/ecma262/#sec-object.defineproperties
    var objectDefineProperties = descriptors ? Object.defineProperties : function defineProperties(O, Properties) {
      anObject(O);
      var keys = objectKeys(Properties);
      var length = keys.length;
      var index = 0;
      var key;
      while (length > index) objectDefineProperty.f(O, key = keys[index++], Properties[key]);
      return O;
    };

    var html = getBuiltIn('document', 'documentElement');

    var IE_PROTO = sharedKey('IE_PROTO');

    var PROTOTYPE = 'prototype';
    var Empty = function () { /* empty */ };

    // Create object with fake `null` prototype: use iframe Object with cleared prototype
    var createDict = function () {
      // Thrash, waste and sodomy: IE GC bug
      var iframe = documentCreateElement('iframe');
      var length = enumBugKeys.length;
      var lt = '<';
      var script = 'script';
      var gt = '>';
      var js = 'java' + script + ':';
      var iframeDocument;
      iframe.style.display = 'none';
      html.appendChild(iframe);
      iframe.src = String(js);
      iframeDocument = iframe.contentWindow.document;
      iframeDocument.open();
      iframeDocument.write(lt + script + gt + 'document.F=Object' + lt + '/' + script + gt);
      iframeDocument.close();
      createDict = iframeDocument.F;
      while (length--) delete createDict[PROTOTYPE][enumBugKeys[length]];
      return createDict();
    };

    // `Object.create` method
    // https://tc39.github.io/ecma262/#sec-object.create
    var objectCreate = Object.create || function create(O, Properties) {
      var result;
      if (O !== null) {
        Empty[PROTOTYPE] = anObject(O);
        result = new Empty();
        Empty[PROTOTYPE] = null;
        // add "__proto__" for Object.getPrototypeOf polyfill
        result[IE_PROTO] = O;
      } else result = createDict();
      return Properties === undefined ? result : objectDefineProperties(result, Properties);
    };

    hiddenKeys[IE_PROTO] = true;

    var f$6 = wellKnownSymbol;

    var wrappedWellKnownSymbol = {
    	f: f$6
    };

    var defineProperty$1 = objectDefineProperty.f;

    var defineWellKnownSymbol = function (NAME) {
      var Symbol = path.Symbol || (path.Symbol = {});
      if (!has(Symbol, NAME)) defineProperty$1(Symbol, NAME, {
        value: wrappedWellKnownSymbol.f(NAME)
      });
    };

    var defineProperty$2 = objectDefineProperty.f;



    var TO_STRING_TAG = wellKnownSymbol('toStringTag');

    var setToStringTag = function (it, TAG, STATIC) {
      if (it && !has(it = STATIC ? it : it.prototype, TO_STRING_TAG)) {
        defineProperty$2(it, TO_STRING_TAG, { configurable: true, value: TAG });
      }
    };

    var aFunction$1 = function (it) {
      if (typeof it != 'function') {
        throw TypeError(String(it) + ' is not a function');
      } return it;
    };

    // optional / simple context binding
    var bindContext = function (fn, that, length) {
      aFunction$1(fn);
      if (that === undefined) return fn;
      switch (length) {
        case 0: return function () {
          return fn.call(that);
        };
        case 1: return function (a) {
          return fn.call(that, a);
        };
        case 2: return function (a, b) {
          return fn.call(that, a, b);
        };
        case 3: return function (a, b, c) {
          return fn.call(that, a, b, c);
        };
      }
      return function (/* ...args */) {
        return fn.apply(that, arguments);
      };
    };

    var SPECIES$2 = wellKnownSymbol('species');

    // `ArraySpeciesCreate` abstract operation
    // https://tc39.github.io/ecma262/#sec-arrayspeciescreate
    var arraySpeciesCreate = function (originalArray, length) {
      var C;
      if (isArray(originalArray)) {
        C = originalArray.constructor;
        // cross-realm fallback
        if (typeof C == 'function' && (C === Array || isArray(C.prototype))) C = undefined;
        else if (isObject(C)) {
          C = C[SPECIES$2];
          if (C === null) C = undefined;
        }
      } return new (C === undefined ? Array : C)(length === 0 ? 0 : length);
    };

    var push = [].push;

    // `Array.prototype.{ forEach, map, filter, some, every, find, findIndex }` methods implementation
    var createMethod$1 = function (TYPE) {
      var IS_MAP = TYPE == 1;
      var IS_FILTER = TYPE == 2;
      var IS_SOME = TYPE == 3;
      var IS_EVERY = TYPE == 4;
      var IS_FIND_INDEX = TYPE == 6;
      var NO_HOLES = TYPE == 5 || IS_FIND_INDEX;
      return function ($this, callbackfn, that, specificCreate) {
        var O = toObject($this);
        var self = indexedObject(O);
        var boundFunction = bindContext(callbackfn, that, 3);
        var length = toLength(self.length);
        var index = 0;
        var create = specificCreate || arraySpeciesCreate;
        var target = IS_MAP ? create($this, length) : IS_FILTER ? create($this, 0) : undefined;
        var value, result;
        for (;length > index; index++) if (NO_HOLES || index in self) {
          value = self[index];
          result = boundFunction(value, index, O);
          if (TYPE) {
            if (IS_MAP) target[index] = result; // map
            else if (result) switch (TYPE) {
              case 3: return true;              // some
              case 5: return value;             // find
              case 6: return index;             // findIndex
              case 2: push.call(target, value); // filter
            } else if (IS_EVERY) return false;  // every
          }
        }
        return IS_FIND_INDEX ? -1 : IS_SOME || IS_EVERY ? IS_EVERY : target;
      };
    };

    var arrayIteration = {
      // `Array.prototype.forEach` method
      // https://tc39.github.io/ecma262/#sec-array.prototype.foreach
      forEach: createMethod$1(0),
      // `Array.prototype.map` method
      // https://tc39.github.io/ecma262/#sec-array.prototype.map
      map: createMethod$1(1),
      // `Array.prototype.filter` method
      // https://tc39.github.io/ecma262/#sec-array.prototype.filter
      filter: createMethod$1(2),
      // `Array.prototype.some` method
      // https://tc39.github.io/ecma262/#sec-array.prototype.some
      some: createMethod$1(3),
      // `Array.prototype.every` method
      // https://tc39.github.io/ecma262/#sec-array.prototype.every
      every: createMethod$1(4),
      // `Array.prototype.find` method
      // https://tc39.github.io/ecma262/#sec-array.prototype.find
      find: createMethod$1(5),
      // `Array.prototype.findIndex` method
      // https://tc39.github.io/ecma262/#sec-array.prototype.findIndex
      findIndex: createMethod$1(6)
    };

    var $forEach = arrayIteration.forEach;

    var HIDDEN = sharedKey('hidden');
    var SYMBOL = 'Symbol';
    var PROTOTYPE$1 = 'prototype';
    var TO_PRIMITIVE = wellKnownSymbol('toPrimitive');
    var setInternalState = internalState.set;
    var getInternalState = internalState.getterFor(SYMBOL);
    var ObjectPrototype = Object[PROTOTYPE$1];
    var $Symbol = global_1.Symbol;
    var JSON$1 = global_1.JSON;
    var nativeJSONStringify = JSON$1 && JSON$1.stringify;
    var nativeGetOwnPropertyDescriptor$1 = objectGetOwnPropertyDescriptor.f;
    var nativeDefineProperty$1 = objectDefineProperty.f;
    var nativeGetOwnPropertyNames$2 = objectGetOwnPropertyNamesExternal.f;
    var nativePropertyIsEnumerable$1 = objectPropertyIsEnumerable.f;
    var AllSymbols = shared('symbols');
    var ObjectPrototypeSymbols = shared('op-symbols');
    var StringToSymbolRegistry = shared('string-to-symbol-registry');
    var SymbolToStringRegistry = shared('symbol-to-string-registry');
    var WellKnownSymbolsStore = shared('wks');
    var QObject = global_1.QObject;
    // Don't use setters in Qt Script, https://github.com/zloirock/core-js/issues/173
    var USE_SETTER = !QObject || !QObject[PROTOTYPE$1] || !QObject[PROTOTYPE$1].findChild;

    // fallback for old Android, https://code.google.com/p/v8/issues/detail?id=687
    var setSymbolDescriptor = descriptors && fails(function () {
      return objectCreate(nativeDefineProperty$1({}, 'a', {
        get: function () { return nativeDefineProperty$1(this, 'a', { value: 7 }).a; }
      })).a != 7;
    }) ? function (O, P, Attributes) {
      var ObjectPrototypeDescriptor = nativeGetOwnPropertyDescriptor$1(ObjectPrototype, P);
      if (ObjectPrototypeDescriptor) delete ObjectPrototype[P];
      nativeDefineProperty$1(O, P, Attributes);
      if (ObjectPrototypeDescriptor && O !== ObjectPrototype) {
        nativeDefineProperty$1(ObjectPrototype, P, ObjectPrototypeDescriptor);
      }
    } : nativeDefineProperty$1;

    var wrap = function (tag, description) {
      var symbol = AllSymbols[tag] = objectCreate($Symbol[PROTOTYPE$1]);
      setInternalState(symbol, {
        type: SYMBOL,
        tag: tag,
        description: description
      });
      if (!descriptors) symbol.description = description;
      return symbol;
    };

    var isSymbol = nativeSymbol && typeof $Symbol.iterator == 'symbol' ? function (it) {
      return typeof it == 'symbol';
    } : function (it) {
      return Object(it) instanceof $Symbol;
    };

    var $defineProperty = function defineProperty(O, P, Attributes) {
      if (O === ObjectPrototype) $defineProperty(ObjectPrototypeSymbols, P, Attributes);
      anObject(O);
      var key = toPrimitive(P, true);
      anObject(Attributes);
      if (has(AllSymbols, key)) {
        if (!Attributes.enumerable) {
          if (!has(O, HIDDEN)) nativeDefineProperty$1(O, HIDDEN, createPropertyDescriptor(1, {}));
          O[HIDDEN][key] = true;
        } else {
          if (has(O, HIDDEN) && O[HIDDEN][key]) O[HIDDEN][key] = false;
          Attributes = objectCreate(Attributes, { enumerable: createPropertyDescriptor(0, false) });
        } return setSymbolDescriptor(O, key, Attributes);
      } return nativeDefineProperty$1(O, key, Attributes);
    };

    var $defineProperties = function defineProperties(O, Properties) {
      anObject(O);
      var properties = toIndexedObject(Properties);
      var keys = objectKeys(properties).concat($getOwnPropertySymbols(properties));
      $forEach(keys, function (key) {
        if (!descriptors || $propertyIsEnumerable.call(properties, key)) $defineProperty(O, key, properties[key]);
      });
      return O;
    };

    var $create = function create(O, Properties) {
      return Properties === undefined ? objectCreate(O) : $defineProperties(objectCreate(O), Properties);
    };

    var $propertyIsEnumerable = function propertyIsEnumerable(V) {
      var P = toPrimitive(V, true);
      var enumerable = nativePropertyIsEnumerable$1.call(this, P);
      if (this === ObjectPrototype && has(AllSymbols, P) && !has(ObjectPrototypeSymbols, P)) return false;
      return enumerable || !has(this, P) || !has(AllSymbols, P) || has(this, HIDDEN) && this[HIDDEN][P] ? enumerable : true;
    };

    var $getOwnPropertyDescriptor = function getOwnPropertyDescriptor(O, P) {
      var it = toIndexedObject(O);
      var key = toPrimitive(P, true);
      if (it === ObjectPrototype && has(AllSymbols, key) && !has(ObjectPrototypeSymbols, key)) return;
      var descriptor = nativeGetOwnPropertyDescriptor$1(it, key);
      if (descriptor && has(AllSymbols, key) && !(has(it, HIDDEN) && it[HIDDEN][key])) {
        descriptor.enumerable = true;
      }
      return descriptor;
    };

    var $getOwnPropertyNames = function getOwnPropertyNames(O) {
      var names = nativeGetOwnPropertyNames$2(toIndexedObject(O));
      var result = [];
      $forEach(names, function (key) {
        if (!has(AllSymbols, key) && !has(hiddenKeys, key)) result.push(key);
      });
      return result;
    };

    var $getOwnPropertySymbols = function getOwnPropertySymbols(O) {
      var IS_OBJECT_PROTOTYPE = O === ObjectPrototype;
      var names = nativeGetOwnPropertyNames$2(IS_OBJECT_PROTOTYPE ? ObjectPrototypeSymbols : toIndexedObject(O));
      var result = [];
      $forEach(names, function (key) {
        if (has(AllSymbols, key) && (!IS_OBJECT_PROTOTYPE || has(ObjectPrototype, key))) {
          result.push(AllSymbols[key]);
        }
      });
      return result;
    };

    // `Symbol` constructor
    // https://tc39.github.io/ecma262/#sec-symbol-constructor
    if (!nativeSymbol) {
      $Symbol = function Symbol() {
        if (this instanceof $Symbol) throw TypeError('Symbol is not a constructor');
        var description = !arguments.length || arguments[0] === undefined ? undefined : String(arguments[0]);
        var tag = uid(description);
        var setter = function (value) {
          if (this === ObjectPrototype) setter.call(ObjectPrototypeSymbols, value);
          if (has(this, HIDDEN) && has(this[HIDDEN], tag)) this[HIDDEN][tag] = false;
          setSymbolDescriptor(this, tag, createPropertyDescriptor(1, value));
        };
        if (descriptors && USE_SETTER) setSymbolDescriptor(ObjectPrototype, tag, { configurable: true, set: setter });
        return wrap(tag, description);
      };

      redefine($Symbol[PROTOTYPE$1], 'toString', function toString() {
        return getInternalState(this).tag;
      });

      objectPropertyIsEnumerable.f = $propertyIsEnumerable;
      objectDefineProperty.f = $defineProperty;
      objectGetOwnPropertyDescriptor.f = $getOwnPropertyDescriptor;
      objectGetOwnPropertyNames.f = objectGetOwnPropertyNamesExternal.f = $getOwnPropertyNames;
      objectGetOwnPropertySymbols.f = $getOwnPropertySymbols;

      if (descriptors) {
        // https://github.com/tc39/proposal-Symbol-description
        nativeDefineProperty$1($Symbol[PROTOTYPE$1], 'description', {
          configurable: true,
          get: function description() {
            return getInternalState(this).description;
          }
        });
        {
          redefine(ObjectPrototype, 'propertyIsEnumerable', $propertyIsEnumerable, { unsafe: true });
        }
      }

      wrappedWellKnownSymbol.f = function (name) {
        return wrap(wellKnownSymbol(name), name);
      };
    }

    _export({ global: true, wrap: true, forced: !nativeSymbol, sham: !nativeSymbol }, {
      Symbol: $Symbol
    });

    $forEach(objectKeys(WellKnownSymbolsStore), function (name) {
      defineWellKnownSymbol(name);
    });

    _export({ target: SYMBOL, stat: true, forced: !nativeSymbol }, {
      // `Symbol.for` method
      // https://tc39.github.io/ecma262/#sec-symbol.for
      'for': function (key) {
        var string = String(key);
        if (has(StringToSymbolRegistry, string)) return StringToSymbolRegistry[string];
        var symbol = $Symbol(string);
        StringToSymbolRegistry[string] = symbol;
        SymbolToStringRegistry[symbol] = string;
        return symbol;
      },
      // `Symbol.keyFor` method
      // https://tc39.github.io/ecma262/#sec-symbol.keyfor
      keyFor: function keyFor(sym) {
        if (!isSymbol(sym)) throw TypeError(sym + ' is not a symbol');
        if (has(SymbolToStringRegistry, sym)) return SymbolToStringRegistry[sym];
      },
      useSetter: function () { USE_SETTER = true; },
      useSimple: function () { USE_SETTER = false; }
    });

    _export({ target: 'Object', stat: true, forced: !nativeSymbol, sham: !descriptors }, {
      // `Object.create` method
      // https://tc39.github.io/ecma262/#sec-object.create
      create: $create,
      // `Object.defineProperty` method
      // https://tc39.github.io/ecma262/#sec-object.defineproperty
      defineProperty: $defineProperty,
      // `Object.defineProperties` method
      // https://tc39.github.io/ecma262/#sec-object.defineproperties
      defineProperties: $defineProperties,
      // `Object.getOwnPropertyDescriptor` method
      // https://tc39.github.io/ecma262/#sec-object.getownpropertydescriptors
      getOwnPropertyDescriptor: $getOwnPropertyDescriptor
    });

    _export({ target: 'Object', stat: true, forced: !nativeSymbol }, {
      // `Object.getOwnPropertyNames` method
      // https://tc39.github.io/ecma262/#sec-object.getownpropertynames
      getOwnPropertyNames: $getOwnPropertyNames,
      // `Object.getOwnPropertySymbols` method
      // https://tc39.github.io/ecma262/#sec-object.getownpropertysymbols
      getOwnPropertySymbols: $getOwnPropertySymbols
    });

    // Chrome 38 and 39 `Object.getOwnPropertySymbols` fails on primitives
    // https://bugs.chromium.org/p/v8/issues/detail?id=3443
    _export({ target: 'Object', stat: true, forced: fails(function () { objectGetOwnPropertySymbols.f(1); }) }, {
      getOwnPropertySymbols: function getOwnPropertySymbols(it) {
        return objectGetOwnPropertySymbols.f(toObject(it));
      }
    });

    // `JSON.stringify` method behavior with symbols
    // https://tc39.github.io/ecma262/#sec-json.stringify
    JSON$1 && _export({ target: 'JSON', stat: true, forced: !nativeSymbol || fails(function () {
      var symbol = $Symbol();
      // MS Edge converts symbol values to JSON as {}
      return nativeJSONStringify([symbol]) != '[null]'
        // WebKit converts symbol values to JSON as null
        || nativeJSONStringify({ a: symbol }) != '{}'
        // V8 throws on boxed symbols
        || nativeJSONStringify(Object(symbol)) != '{}';
    }) }, {
      stringify: function stringify(it) {
        var args = [it];
        var index = 1;
        var replacer, $replacer;
        while (arguments.length > index) args.push(arguments[index++]);
        $replacer = replacer = args[1];
        if (!isObject(replacer) && it === undefined || isSymbol(it)) return; // IE8 returns string on undefined
        if (!isArray(replacer)) replacer = function (key, value) {
          if (typeof $replacer == 'function') value = $replacer.call(this, key, value);
          if (!isSymbol(value)) return value;
        };
        args[1] = replacer;
        return nativeJSONStringify.apply(JSON$1, args);
      }
    });

    // `Symbol.prototype[@@toPrimitive]` method
    // https://tc39.github.io/ecma262/#sec-symbol.prototype-@@toprimitive
    if (!$Symbol[PROTOTYPE$1][TO_PRIMITIVE]) {
      createNonEnumerableProperty($Symbol[PROTOTYPE$1], TO_PRIMITIVE, $Symbol[PROTOTYPE$1].valueOf);
    }
    // `Symbol.prototype[@@toStringTag]` property
    // https://tc39.github.io/ecma262/#sec-symbol.prototype-@@tostringtag
    setToStringTag($Symbol, SYMBOL);

    hiddenKeys[HIDDEN] = true;

    var defineProperty$3 = objectDefineProperty.f;


    var NativeSymbol = global_1.Symbol;

    if (descriptors && typeof NativeSymbol == 'function' && (!('description' in NativeSymbol.prototype) ||
      // Safari 12 bug
      NativeSymbol().description !== undefined
    )) {
      var EmptyStringDescriptionStore = {};
      // wrap Symbol constructor for correct work with undefined description
      var SymbolWrapper = function Symbol() {
        var description = arguments.length < 1 || arguments[0] === undefined ? undefined : String(arguments[0]);
        var result = this instanceof SymbolWrapper
          ? new NativeSymbol(description)
          // in Edge 13, String(Symbol(undefined)) === 'Symbol(undefined)'
          : description === undefined ? NativeSymbol() : NativeSymbol(description);
        if (description === '') EmptyStringDescriptionStore[result] = true;
        return result;
      };
      copyConstructorProperties(SymbolWrapper, NativeSymbol);
      var symbolPrototype = SymbolWrapper.prototype = NativeSymbol.prototype;
      symbolPrototype.constructor = SymbolWrapper;

      var symbolToString = symbolPrototype.toString;
      var native = String(NativeSymbol('test')) == 'Symbol(test)';
      var regexp = /^Symbol\((.*)\)[^)]+$/;
      defineProperty$3(symbolPrototype, 'description', {
        configurable: true,
        get: function description() {
          var symbol = isObject(this) ? this.valueOf() : this;
          var string = symbolToString.call(symbol);
          if (has(EmptyStringDescriptionStore, symbol)) return '';
          var desc = native ? string.slice(7, -1) : string.replace(regexp, '$1');
          return desc === '' ? undefined : desc;
        }
      });

      _export({ global: true, forced: true }, {
        Symbol: SymbolWrapper
      });
    }

    // `Symbol.iterator` well-known symbol
    // https://tc39.github.io/ecma262/#sec-symbol.iterator
    defineWellKnownSymbol('iterator');

    var UNSCOPABLES = wellKnownSymbol('unscopables');
    var ArrayPrototype = Array.prototype;

    // Array.prototype[@@unscopables]
    // https://tc39.github.io/ecma262/#sec-array.prototype-@@unscopables
    if (ArrayPrototype[UNSCOPABLES] == undefined) {
      createNonEnumerableProperty(ArrayPrototype, UNSCOPABLES, objectCreate(null));
    }

    // add a key to Array.prototype[@@unscopables]
    var addToUnscopables = function (key) {
      ArrayPrototype[UNSCOPABLES][key] = true;
    };

    var iterators = {};

    var correctPrototypeGetter = !fails(function () {
      function F() { /* empty */ }
      F.prototype.constructor = null;
      return Object.getPrototypeOf(new F()) !== F.prototype;
    });

    var IE_PROTO$1 = sharedKey('IE_PROTO');
    var ObjectPrototype$1 = Object.prototype;

    // `Object.getPrototypeOf` method
    // https://tc39.github.io/ecma262/#sec-object.getprototypeof
    var objectGetPrototypeOf = correctPrototypeGetter ? Object.getPrototypeOf : function (O) {
      O = toObject(O);
      if (has(O, IE_PROTO$1)) return O[IE_PROTO$1];
      if (typeof O.constructor == 'function' && O instanceof O.constructor) {
        return O.constructor.prototype;
      } return O instanceof Object ? ObjectPrototype$1 : null;
    };

    var ITERATOR = wellKnownSymbol('iterator');
    var BUGGY_SAFARI_ITERATORS = false;

    var returnThis = function () { return this; };

    // `%IteratorPrototype%` object
    // https://tc39.github.io/ecma262/#sec-%iteratorprototype%-object
    var IteratorPrototype, PrototypeOfArrayIteratorPrototype, arrayIterator;

    if ([].keys) {
      arrayIterator = [].keys();
      // Safari 8 has buggy iterators w/o `next`
      if (!('next' in arrayIterator)) BUGGY_SAFARI_ITERATORS = true;
      else {
        PrototypeOfArrayIteratorPrototype = objectGetPrototypeOf(objectGetPrototypeOf(arrayIterator));
        if (PrototypeOfArrayIteratorPrototype !== Object.prototype) IteratorPrototype = PrototypeOfArrayIteratorPrototype;
      }
    }

    if (IteratorPrototype == undefined) IteratorPrototype = {};

    // 25.1.2.1.1 %IteratorPrototype%[@@iterator]()
    if ( !has(IteratorPrototype, ITERATOR)) {
      createNonEnumerableProperty(IteratorPrototype, ITERATOR, returnThis);
    }

    var iteratorsCore = {
      IteratorPrototype: IteratorPrototype,
      BUGGY_SAFARI_ITERATORS: BUGGY_SAFARI_ITERATORS
    };

    var IteratorPrototype$1 = iteratorsCore.IteratorPrototype;





    var returnThis$1 = function () { return this; };

    var createIteratorConstructor = function (IteratorConstructor, NAME, next) {
      var TO_STRING_TAG = NAME + ' Iterator';
      IteratorConstructor.prototype = objectCreate(IteratorPrototype$1, { next: createPropertyDescriptor(1, next) });
      setToStringTag(IteratorConstructor, TO_STRING_TAG, false);
      iterators[TO_STRING_TAG] = returnThis$1;
      return IteratorConstructor;
    };

    var aPossiblePrototype = function (it) {
      if (!isObject(it) && it !== null) {
        throw TypeError("Can't set " + String(it) + ' as a prototype');
      } return it;
    };

    // `Object.setPrototypeOf` method
    // https://tc39.github.io/ecma262/#sec-object.setprototypeof
    // Works with __proto__ only. Old v8 can't work with null proto objects.
    /* eslint-disable no-proto */
    var objectSetPrototypeOf = Object.setPrototypeOf || ('__proto__' in {} ? function () {
      var CORRECT_SETTER = false;
      var test = {};
      var setter;
      try {
        setter = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__').set;
        setter.call(test, []);
        CORRECT_SETTER = test instanceof Array;
      } catch (error) { /* empty */ }
      return function setPrototypeOf(O, proto) {
        anObject(O);
        aPossiblePrototype(proto);
        if (CORRECT_SETTER) setter.call(O, proto);
        else O.__proto__ = proto;
        return O;
      };
    }() : undefined);

    var IteratorPrototype$2 = iteratorsCore.IteratorPrototype;
    var BUGGY_SAFARI_ITERATORS$1 = iteratorsCore.BUGGY_SAFARI_ITERATORS;
    var ITERATOR$1 = wellKnownSymbol('iterator');
    var KEYS = 'keys';
    var VALUES = 'values';
    var ENTRIES = 'entries';

    var returnThis$2 = function () { return this; };

    var defineIterator = function (Iterable, NAME, IteratorConstructor, next, DEFAULT, IS_SET, FORCED) {
      createIteratorConstructor(IteratorConstructor, NAME, next);

      var getIterationMethod = function (KIND) {
        if (KIND === DEFAULT && defaultIterator) return defaultIterator;
        if (!BUGGY_SAFARI_ITERATORS$1 && KIND in IterablePrototype) return IterablePrototype[KIND];
        switch (KIND) {
          case KEYS: return function keys() { return new IteratorConstructor(this, KIND); };
          case VALUES: return function values() { return new IteratorConstructor(this, KIND); };
          case ENTRIES: return function entries() { return new IteratorConstructor(this, KIND); };
        } return function () { return new IteratorConstructor(this); };
      };

      var TO_STRING_TAG = NAME + ' Iterator';
      var INCORRECT_VALUES_NAME = false;
      var IterablePrototype = Iterable.prototype;
      var nativeIterator = IterablePrototype[ITERATOR$1]
        || IterablePrototype['@@iterator']
        || DEFAULT && IterablePrototype[DEFAULT];
      var defaultIterator = !BUGGY_SAFARI_ITERATORS$1 && nativeIterator || getIterationMethod(DEFAULT);
      var anyNativeIterator = NAME == 'Array' ? IterablePrototype.entries || nativeIterator : nativeIterator;
      var CurrentIteratorPrototype, methods, KEY;

      // fix native
      if (anyNativeIterator) {
        CurrentIteratorPrototype = objectGetPrototypeOf(anyNativeIterator.call(new Iterable()));
        if (IteratorPrototype$2 !== Object.prototype && CurrentIteratorPrototype.next) {
          if ( objectGetPrototypeOf(CurrentIteratorPrototype) !== IteratorPrototype$2) {
            if (objectSetPrototypeOf) {
              objectSetPrototypeOf(CurrentIteratorPrototype, IteratorPrototype$2);
            } else if (typeof CurrentIteratorPrototype[ITERATOR$1] != 'function') {
              createNonEnumerableProperty(CurrentIteratorPrototype, ITERATOR$1, returnThis$2);
            }
          }
          // Set @@toStringTag to native iterators
          setToStringTag(CurrentIteratorPrototype, TO_STRING_TAG, true);
        }
      }

      // fix Array#{values, @@iterator}.name in V8 / FF
      if (DEFAULT == VALUES && nativeIterator && nativeIterator.name !== VALUES) {
        INCORRECT_VALUES_NAME = true;
        defaultIterator = function values() { return nativeIterator.call(this); };
      }

      // define iterator
      if ( IterablePrototype[ITERATOR$1] !== defaultIterator) {
        createNonEnumerableProperty(IterablePrototype, ITERATOR$1, defaultIterator);
      }
      iterators[NAME] = defaultIterator;

      // export additional methods
      if (DEFAULT) {
        methods = {
          values: getIterationMethod(VALUES),
          keys: IS_SET ? defaultIterator : getIterationMethod(KEYS),
          entries: getIterationMethod(ENTRIES)
        };
        if (FORCED) for (KEY in methods) {
          if (BUGGY_SAFARI_ITERATORS$1 || INCORRECT_VALUES_NAME || !(KEY in IterablePrototype)) {
            redefine(IterablePrototype, KEY, methods[KEY]);
          }
        } else _export({ target: NAME, proto: true, forced: BUGGY_SAFARI_ITERATORS$1 || INCORRECT_VALUES_NAME }, methods);
      }

      return methods;
    };

    var ARRAY_ITERATOR = 'Array Iterator';
    var setInternalState$1 = internalState.set;
    var getInternalState$1 = internalState.getterFor(ARRAY_ITERATOR);

    // `Array.prototype.entries` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.entries
    // `Array.prototype.keys` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.keys
    // `Array.prototype.values` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.values
    // `Array.prototype[@@iterator]` method
    // https://tc39.github.io/ecma262/#sec-array.prototype-@@iterator
    // `CreateArrayIterator` internal method
    // https://tc39.github.io/ecma262/#sec-createarrayiterator
    var es_array_iterator = defineIterator(Array, 'Array', function (iterated, kind) {
      setInternalState$1(this, {
        type: ARRAY_ITERATOR,
        target: toIndexedObject(iterated), // target
        index: 0,                          // next index
        kind: kind                         // kind
      });
    // `%ArrayIteratorPrototype%.next` method
    // https://tc39.github.io/ecma262/#sec-%arrayiteratorprototype%.next
    }, function () {
      var state = getInternalState$1(this);
      var target = state.target;
      var kind = state.kind;
      var index = state.index++;
      if (!target || index >= target.length) {
        state.target = undefined;
        return { value: undefined, done: true };
      }
      if (kind == 'keys') return { value: index, done: false };
      if (kind == 'values') return { value: target[index], done: false };
      return { value: [index, target[index]], done: false };
    }, 'values');

    // argumentsList[@@iterator] is %ArrayProto_values%
    // https://tc39.github.io/ecma262/#sec-createunmappedargumentsobject
    // https://tc39.github.io/ecma262/#sec-createmappedargumentsobject
    iterators.Arguments = iterators.Array;

    // https://tc39.github.io/ecma262/#sec-array.prototype-@@unscopables
    addToUnscopables('keys');
    addToUnscopables('values');
    addToUnscopables('entries');

    var nativeAssign = Object.assign;

    // `Object.assign` method
    // https://tc39.github.io/ecma262/#sec-object.assign
    // should work with symbols and should have deterministic property order (V8 bug)
    var objectAssign = !nativeAssign || fails(function () {
      var A = {};
      var B = {};
      // eslint-disable-next-line no-undef
      var symbol = Symbol();
      var alphabet = 'abcdefghijklmnopqrst';
      A[symbol] = 7;
      alphabet.split('').forEach(function (chr) { B[chr] = chr; });
      return nativeAssign({}, A)[symbol] != 7 || objectKeys(nativeAssign({}, B)).join('') != alphabet;
    }) ? function assign(target, source) { // eslint-disable-line no-unused-vars
      var T = toObject(target);
      var argumentsLength = arguments.length;
      var index = 1;
      var getOwnPropertySymbols = objectGetOwnPropertySymbols.f;
      var propertyIsEnumerable = objectPropertyIsEnumerable.f;
      while (argumentsLength > index) {
        var S = indexedObject(arguments[index++]);
        var keys = getOwnPropertySymbols ? objectKeys(S).concat(getOwnPropertySymbols(S)) : objectKeys(S);
        var length = keys.length;
        var j = 0;
        var key;
        while (length > j) {
          key = keys[j++];
          if (!descriptors || propertyIsEnumerable.call(S, key)) T[key] = S[key];
        }
      } return T;
    } : nativeAssign;

    // `Object.assign` method
    // https://tc39.github.io/ecma262/#sec-object.assign
    _export({ target: 'Object', stat: true, forced: Object.assign !== objectAssign }, {
      assign: objectAssign
    });

    var TO_STRING_TAG$1 = wellKnownSymbol('toStringTag');
    // ES3 wrong here
    var CORRECT_ARGUMENTS = classofRaw(function () { return arguments; }()) == 'Arguments';

    // fallback for IE11 Script Access Denied error
    var tryGet = function (it, key) {
      try {
        return it[key];
      } catch (error) { /* empty */ }
    };

    // getting tag from ES6+ `Object.prototype.toString`
    var classof = function (it) {
      var O, tag, result;
      return it === undefined ? 'Undefined' : it === null ? 'Null'
        // @@toStringTag case
        : typeof (tag = tryGet(O = Object(it), TO_STRING_TAG$1)) == 'string' ? tag
        // builtinTag case
        : CORRECT_ARGUMENTS ? classofRaw(O)
        // ES3 arguments fallback
        : (result = classofRaw(O)) == 'Object' && typeof O.callee == 'function' ? 'Arguments' : result;
    };

    var TO_STRING_TAG$2 = wellKnownSymbol('toStringTag');
    var test = {};

    test[TO_STRING_TAG$2] = 'z';

    // `Object.prototype.toString` method implementation
    // https://tc39.github.io/ecma262/#sec-object.prototype.tostring
    var objectToString = String(test) !== '[object z]' ? function toString() {
      return '[object ' + classof(this) + ']';
    } : test.toString;

    var ObjectPrototype$2 = Object.prototype;

    // `Object.prototype.toString` method
    // https://tc39.github.io/ecma262/#sec-object.prototype.tostring
    if (objectToString !== ObjectPrototype$2.toString) {
      redefine(ObjectPrototype$2, 'toString', objectToString, { unsafe: true });
    }

    var freezing = !fails(function () {
      return Object.isExtensible(Object.preventExtensions({}));
    });

    var internalMetadata = createCommonjsModule$1(function (module) {
    var defineProperty = objectDefineProperty.f;



    var METADATA = uid('meta');
    var id = 0;

    var isExtensible = Object.isExtensible || function () {
      return true;
    };

    var setMetadata = function (it) {
      defineProperty(it, METADATA, { value: {
        objectID: 'O' + ++id, // object ID
        weakData: {}          // weak collections IDs
      } });
    };

    var fastKey = function (it, create) {
      // return a primitive with prefix
      if (!isObject(it)) return typeof it == 'symbol' ? it : (typeof it == 'string' ? 'S' : 'P') + it;
      if (!has(it, METADATA)) {
        // can't set metadata to uncaught frozen object
        if (!isExtensible(it)) return 'F';
        // not necessary to add metadata
        if (!create) return 'E';
        // add missing metadata
        setMetadata(it);
      // return object ID
      } return it[METADATA].objectID;
    };

    var getWeakData = function (it, create) {
      if (!has(it, METADATA)) {
        // can't set metadata to uncaught frozen object
        if (!isExtensible(it)) return true;
        // not necessary to add metadata
        if (!create) return false;
        // add missing metadata
        setMetadata(it);
      // return the store of weak collections IDs
      } return it[METADATA].weakData;
    };

    // add metadata on freeze-family methods calling
    var onFreeze = function (it) {
      if (freezing && meta.REQUIRED && isExtensible(it) && !has(it, METADATA)) setMetadata(it);
      return it;
    };

    var meta = module.exports = {
      REQUIRED: false,
      fastKey: fastKey,
      getWeakData: getWeakData,
      onFreeze: onFreeze
    };

    hiddenKeys[METADATA] = true;
    });

    var ITERATOR$2 = wellKnownSymbol('iterator');
    var ArrayPrototype$1 = Array.prototype;

    // check on default Array iterator
    var isArrayIteratorMethod = function (it) {
      return it !== undefined && (iterators.Array === it || ArrayPrototype$1[ITERATOR$2] === it);
    };

    var ITERATOR$3 = wellKnownSymbol('iterator');

    var getIteratorMethod = function (it) {
      if (it != undefined) return it[ITERATOR$3]
        || it['@@iterator']
        || iterators[classof(it)];
    };

    // call something on iterator step with safe closing on error
    var callWithSafeIterationClosing = function (iterator, fn, value, ENTRIES) {
      try {
        return ENTRIES ? fn(anObject(value)[0], value[1]) : fn(value);
      // 7.4.6 IteratorClose(iterator, completion)
      } catch (error) {
        var returnMethod = iterator['return'];
        if (returnMethod !== undefined) anObject(returnMethod.call(iterator));
        throw error;
      }
    };

    var iterate_1 = createCommonjsModule$1(function (module) {
    var Result = function (stopped, result) {
      this.stopped = stopped;
      this.result = result;
    };

    var iterate = module.exports = function (iterable, fn, that, AS_ENTRIES, IS_ITERATOR) {
      var boundFunction = bindContext(fn, that, AS_ENTRIES ? 2 : 1);
      var iterator, iterFn, index, length, result, next, step;

      if (IS_ITERATOR) {
        iterator = iterable;
      } else {
        iterFn = getIteratorMethod(iterable);
        if (typeof iterFn != 'function') throw TypeError('Target is not iterable');
        // optimisation for array iterators
        if (isArrayIteratorMethod(iterFn)) {
          for (index = 0, length = toLength(iterable.length); length > index; index++) {
            result = AS_ENTRIES
              ? boundFunction(anObject(step = iterable[index])[0], step[1])
              : boundFunction(iterable[index]);
            if (result && result instanceof Result) return result;
          } return new Result(false);
        }
        iterator = iterFn.call(iterable);
      }

      next = iterator.next;
      while (!(step = next.call(iterator)).done) {
        result = callWithSafeIterationClosing(iterator, boundFunction, step.value, AS_ENTRIES);
        if (typeof result == 'object' && result && result instanceof Result) return result;
      } return new Result(false);
    };

    iterate.stop = function (result) {
      return new Result(true, result);
    };
    });

    var anInstance = function (it, Constructor, name) {
      if (!(it instanceof Constructor)) {
        throw TypeError('Incorrect ' + (name ? name + ' ' : '') + 'invocation');
      } return it;
    };

    var ITERATOR$4 = wellKnownSymbol('iterator');
    var SAFE_CLOSING = false;

    try {
      var called = 0;
      var iteratorWithReturn = {
        next: function () {
          return { done: !!called++ };
        },
        'return': function () {
          SAFE_CLOSING = true;
        }
      };
      iteratorWithReturn[ITERATOR$4] = function () {
        return this;
      };
      // eslint-disable-next-line no-throw-literal
      Array.from(iteratorWithReturn, function () { throw 2; });
    } catch (error) { /* empty */ }

    var checkCorrectnessOfIteration = function (exec, SKIP_CLOSING) {
      if (!SKIP_CLOSING && !SAFE_CLOSING) return false;
      var ITERATION_SUPPORT = false;
      try {
        var object = {};
        object[ITERATOR$4] = function () {
          return {
            next: function () {
              return { done: ITERATION_SUPPORT = true };
            }
          };
        };
        exec(object);
      } catch (error) { /* empty */ }
      return ITERATION_SUPPORT;
    };

    // makes subclassing work correct for wrapped built-ins
    var inheritIfRequired = function ($this, dummy, Wrapper) {
      var NewTarget, NewTargetPrototype;
      if (
        // it can work only with native `setPrototypeOf`
        objectSetPrototypeOf &&
        // we haven't completely correct pre-ES6 way for getting `new.target`, so use this
        typeof (NewTarget = dummy.constructor) == 'function' &&
        NewTarget !== Wrapper &&
        isObject(NewTargetPrototype = NewTarget.prototype) &&
        NewTargetPrototype !== Wrapper.prototype
      ) objectSetPrototypeOf($this, NewTargetPrototype);
      return $this;
    };

    var collection = function (CONSTRUCTOR_NAME, wrapper, common, IS_MAP, IS_WEAK) {
      var NativeConstructor = global_1[CONSTRUCTOR_NAME];
      var NativePrototype = NativeConstructor && NativeConstructor.prototype;
      var Constructor = NativeConstructor;
      var ADDER = IS_MAP ? 'set' : 'add';
      var exported = {};

      var fixMethod = function (KEY) {
        var nativeMethod = NativePrototype[KEY];
        redefine(NativePrototype, KEY,
          KEY == 'add' ? function add(value) {
            nativeMethod.call(this, value === 0 ? 0 : value);
            return this;
          } : KEY == 'delete' ? function (key) {
            return IS_WEAK && !isObject(key) ? false : nativeMethod.call(this, key === 0 ? 0 : key);
          } : KEY == 'get' ? function get(key) {
            return IS_WEAK && !isObject(key) ? undefined : nativeMethod.call(this, key === 0 ? 0 : key);
          } : KEY == 'has' ? function has(key) {
            return IS_WEAK && !isObject(key) ? false : nativeMethod.call(this, key === 0 ? 0 : key);
          } : function set(key, value) {
            nativeMethod.call(this, key === 0 ? 0 : key, value);
            return this;
          }
        );
      };

      // eslint-disable-next-line max-len
      if (isForced_1(CONSTRUCTOR_NAME, typeof NativeConstructor != 'function' || !(IS_WEAK || NativePrototype.forEach && !fails(function () {
        new NativeConstructor().entries().next();
      })))) {
        // create collection constructor
        Constructor = common.getConstructor(wrapper, CONSTRUCTOR_NAME, IS_MAP, ADDER);
        internalMetadata.REQUIRED = true;
      } else if (isForced_1(CONSTRUCTOR_NAME, true)) {
        var instance = new Constructor();
        // early implementations not supports chaining
        var HASNT_CHAINING = instance[ADDER](IS_WEAK ? {} : -0, 1) != instance;
        // V8 ~ Chromium 40- weak-collections throws on primitives, but should return false
        var THROWS_ON_PRIMITIVES = fails(function () { instance.has(1); });
        // most early implementations doesn't supports iterables, most modern - not close it correctly
        // eslint-disable-next-line no-new
        var ACCEPT_ITERABLES = checkCorrectnessOfIteration(function (iterable) { new NativeConstructor(iterable); });
        // for early implementations -0 and +0 not the same
        var BUGGY_ZERO = !IS_WEAK && fails(function () {
          // V8 ~ Chromium 42- fails only with 5+ elements
          var $instance = new NativeConstructor();
          var index = 5;
          while (index--) $instance[ADDER](index, index);
          return !$instance.has(-0);
        });

        if (!ACCEPT_ITERABLES) {
          Constructor = wrapper(function (dummy, iterable) {
            anInstance(dummy, Constructor, CONSTRUCTOR_NAME);
            var that = inheritIfRequired(new NativeConstructor(), dummy, Constructor);
            if (iterable != undefined) iterate_1(iterable, that[ADDER], that, IS_MAP);
            return that;
          });
          Constructor.prototype = NativePrototype;
          NativePrototype.constructor = Constructor;
        }

        if (THROWS_ON_PRIMITIVES || BUGGY_ZERO) {
          fixMethod('delete');
          fixMethod('has');
          IS_MAP && fixMethod('get');
        }

        if (BUGGY_ZERO || HASNT_CHAINING) fixMethod(ADDER);

        // weak collections should not contains .clear method
        if (IS_WEAK && NativePrototype.clear) delete NativePrototype.clear;
      }

      exported[CONSTRUCTOR_NAME] = Constructor;
      _export({ global: true, forced: Constructor != NativeConstructor }, exported);

      setToStringTag(Constructor, CONSTRUCTOR_NAME);

      if (!IS_WEAK) common.setStrong(Constructor, CONSTRUCTOR_NAME, IS_MAP);

      return Constructor;
    };

    var redefineAll = function (target, src, options) {
      for (var key in src) redefine(target, key, src[key], options);
      return target;
    };

    var SPECIES$3 = wellKnownSymbol('species');

    var setSpecies = function (CONSTRUCTOR_NAME) {
      var Constructor = getBuiltIn(CONSTRUCTOR_NAME);
      var defineProperty = objectDefineProperty.f;

      if (descriptors && Constructor && !Constructor[SPECIES$3]) {
        defineProperty(Constructor, SPECIES$3, {
          configurable: true,
          get: function () { return this; }
        });
      }
    };

    var defineProperty$4 = objectDefineProperty.f;








    var fastKey = internalMetadata.fastKey;


    var setInternalState$2 = internalState.set;
    var internalStateGetterFor = internalState.getterFor;

    var collectionStrong = {
      getConstructor: function (wrapper, CONSTRUCTOR_NAME, IS_MAP, ADDER) {
        var C = wrapper(function (that, iterable) {
          anInstance(that, C, CONSTRUCTOR_NAME);
          setInternalState$2(that, {
            type: CONSTRUCTOR_NAME,
            index: objectCreate(null),
            first: undefined,
            last: undefined,
            size: 0
          });
          if (!descriptors) that.size = 0;
          if (iterable != undefined) iterate_1(iterable, that[ADDER], that, IS_MAP);
        });

        var getInternalState = internalStateGetterFor(CONSTRUCTOR_NAME);

        var define = function (that, key, value) {
          var state = getInternalState(that);
          var entry = getEntry(that, key);
          var previous, index;
          // change existing entry
          if (entry) {
            entry.value = value;
          // create new entry
          } else {
            state.last = entry = {
              index: index = fastKey(key, true),
              key: key,
              value: value,
              previous: previous = state.last,
              next: undefined,
              removed: false
            };
            if (!state.first) state.first = entry;
            if (previous) previous.next = entry;
            if (descriptors) state.size++;
            else that.size++;
            // add to index
            if (index !== 'F') state.index[index] = entry;
          } return that;
        };

        var getEntry = function (that, key) {
          var state = getInternalState(that);
          // fast case
          var index = fastKey(key);
          var entry;
          if (index !== 'F') return state.index[index];
          // frozen object case
          for (entry = state.first; entry; entry = entry.next) {
            if (entry.key == key) return entry;
          }
        };

        redefineAll(C.prototype, {
          // 23.1.3.1 Map.prototype.clear()
          // 23.2.3.2 Set.prototype.clear()
          clear: function clear() {
            var that = this;
            var state = getInternalState(that);
            var data = state.index;
            var entry = state.first;
            while (entry) {
              entry.removed = true;
              if (entry.previous) entry.previous = entry.previous.next = undefined;
              delete data[entry.index];
              entry = entry.next;
            }
            state.first = state.last = undefined;
            if (descriptors) state.size = 0;
            else that.size = 0;
          },
          // 23.1.3.3 Map.prototype.delete(key)
          // 23.2.3.4 Set.prototype.delete(value)
          'delete': function (key) {
            var that = this;
            var state = getInternalState(that);
            var entry = getEntry(that, key);
            if (entry) {
              var next = entry.next;
              var prev = entry.previous;
              delete state.index[entry.index];
              entry.removed = true;
              if (prev) prev.next = next;
              if (next) next.previous = prev;
              if (state.first == entry) state.first = next;
              if (state.last == entry) state.last = prev;
              if (descriptors) state.size--;
              else that.size--;
            } return !!entry;
          },
          // 23.2.3.6 Set.prototype.forEach(callbackfn, thisArg = undefined)
          // 23.1.3.5 Map.prototype.forEach(callbackfn, thisArg = undefined)
          forEach: function forEach(callbackfn /* , that = undefined */) {
            var state = getInternalState(this);
            var boundFunction = bindContext(callbackfn, arguments.length > 1 ? arguments[1] : undefined, 3);
            var entry;
            while (entry = entry ? entry.next : state.first) {
              boundFunction(entry.value, entry.key, this);
              // revert to the last existing entry
              while (entry && entry.removed) entry = entry.previous;
            }
          },
          // 23.1.3.7 Map.prototype.has(key)
          // 23.2.3.7 Set.prototype.has(value)
          has: function has(key) {
            return !!getEntry(this, key);
          }
        });

        redefineAll(C.prototype, IS_MAP ? {
          // 23.1.3.6 Map.prototype.get(key)
          get: function get(key) {
            var entry = getEntry(this, key);
            return entry && entry.value;
          },
          // 23.1.3.9 Map.prototype.set(key, value)
          set: function set(key, value) {
            return define(this, key === 0 ? 0 : key, value);
          }
        } : {
          // 23.2.3.1 Set.prototype.add(value)
          add: function add(value) {
            return define(this, value = value === 0 ? 0 : value, value);
          }
        });
        if (descriptors) defineProperty$4(C.prototype, 'size', {
          get: function () {
            return getInternalState(this).size;
          }
        });
        return C;
      },
      setStrong: function (C, CONSTRUCTOR_NAME, IS_MAP) {
        var ITERATOR_NAME = CONSTRUCTOR_NAME + ' Iterator';
        var getInternalCollectionState = internalStateGetterFor(CONSTRUCTOR_NAME);
        var getInternalIteratorState = internalStateGetterFor(ITERATOR_NAME);
        // add .keys, .values, .entries, [@@iterator]
        // 23.1.3.4, 23.1.3.8, 23.1.3.11, 23.1.3.12, 23.2.3.5, 23.2.3.8, 23.2.3.10, 23.2.3.11
        defineIterator(C, CONSTRUCTOR_NAME, function (iterated, kind) {
          setInternalState$2(this, {
            type: ITERATOR_NAME,
            target: iterated,
            state: getInternalCollectionState(iterated),
            kind: kind,
            last: undefined
          });
        }, function () {
          var state = getInternalIteratorState(this);
          var kind = state.kind;
          var entry = state.last;
          // revert to the last existing entry
          while (entry && entry.removed) entry = entry.previous;
          // get next entry
          if (!state.target || !(state.last = entry = entry ? entry.next : state.state.first)) {
            // or finish the iteration
            state.target = undefined;
            return { value: undefined, done: true };
          }
          // return step by kind
          if (kind == 'keys') return { value: entry.key, done: false };
          if (kind == 'values') return { value: entry.value, done: false };
          return { value: [entry.key, entry.value], done: false };
        }, IS_MAP ? 'entries' : 'values', !IS_MAP, true);

        // add [@@species], 23.1.2.2, 23.2.2.2
        setSpecies(CONSTRUCTOR_NAME);
      }
    };

    // `Set` constructor
    // https://tc39.github.io/ecma262/#sec-set-objects
    var es_set = collection('Set', function (get) {
      return function Set() { return get(this, arguments.length ? arguments[0] : undefined); };
    }, collectionStrong);

    // `String.prototype.{ codePointAt, at }` methods implementation
    var createMethod$2 = function (CONVERT_TO_STRING) {
      return function ($this, pos) {
        var S = String(requireObjectCoercible($this));
        var position = toInteger(pos);
        var size = S.length;
        var first, second;
        if (position < 0 || position >= size) return CONVERT_TO_STRING ? '' : undefined;
        first = S.charCodeAt(position);
        return first < 0xD800 || first > 0xDBFF || position + 1 === size
          || (second = S.charCodeAt(position + 1)) < 0xDC00 || second > 0xDFFF
            ? CONVERT_TO_STRING ? S.charAt(position) : first
            : CONVERT_TO_STRING ? S.slice(position, position + 2) : (first - 0xD800 << 10) + (second - 0xDC00) + 0x10000;
      };
    };

    var stringMultibyte = {
      // `String.prototype.codePointAt` method
      // https://tc39.github.io/ecma262/#sec-string.prototype.codepointat
      codeAt: createMethod$2(false),
      // `String.prototype.at` method
      // https://github.com/mathiasbynens/String.prototype.at
      charAt: createMethod$2(true)
    };

    var charAt = stringMultibyte.charAt;



    var STRING_ITERATOR = 'String Iterator';
    var setInternalState$3 = internalState.set;
    var getInternalState$2 = internalState.getterFor(STRING_ITERATOR);

    // `String.prototype[@@iterator]` method
    // https://tc39.github.io/ecma262/#sec-string.prototype-@@iterator
    defineIterator(String, 'String', function (iterated) {
      setInternalState$3(this, {
        type: STRING_ITERATOR,
        string: String(iterated),
        index: 0
      });
    // `%StringIteratorPrototype%.next` method
    // https://tc39.github.io/ecma262/#sec-%stringiteratorprototype%.next
    }, function next() {
      var state = getInternalState$2(this);
      var string = state.string;
      var index = state.index;
      var point;
      if (index >= string.length) return { value: undefined, done: true };
      point = charAt(string, index);
      state.index += point.length;
      return { value: point, done: false };
    });

    // iterable DOM collections
    // flag - `iterable` interface - 'entries', 'keys', 'values', 'forEach' methods
    var domIterables = {
      CSSRuleList: 0,
      CSSStyleDeclaration: 0,
      CSSValueList: 0,
      ClientRectList: 0,
      DOMRectList: 0,
      DOMStringList: 0,
      DOMTokenList: 1,
      DataTransferItemList: 0,
      FileList: 0,
      HTMLAllCollection: 0,
      HTMLCollection: 0,
      HTMLFormElement: 0,
      HTMLSelectElement: 0,
      MediaList: 0,
      MimeTypeArray: 0,
      NamedNodeMap: 0,
      NodeList: 1,
      PaintRequestList: 0,
      Plugin: 0,
      PluginArray: 0,
      SVGLengthList: 0,
      SVGNumberList: 0,
      SVGPathSegList: 0,
      SVGPointList: 0,
      SVGStringList: 0,
      SVGTransformList: 0,
      SourceBufferList: 0,
      StyleSheetList: 0,
      TextTrackCueList: 0,
      TextTrackList: 0,
      TouchList: 0
    };

    var ITERATOR$5 = wellKnownSymbol('iterator');
    var TO_STRING_TAG$3 = wellKnownSymbol('toStringTag');
    var ArrayValues = es_array_iterator.values;

    for (var COLLECTION_NAME in domIterables) {
      var Collection = global_1[COLLECTION_NAME];
      var CollectionPrototype = Collection && Collection.prototype;
      if (CollectionPrototype) {
        // some Chrome versions have non-configurable methods on DOMTokenList
        if (CollectionPrototype[ITERATOR$5] !== ArrayValues) try {
          createNonEnumerableProperty(CollectionPrototype, ITERATOR$5, ArrayValues);
        } catch (error) {
          CollectionPrototype[ITERATOR$5] = ArrayValues;
        }
        if (!CollectionPrototype[TO_STRING_TAG$3]) {
          createNonEnumerableProperty(CollectionPrototype, TO_STRING_TAG$3, COLLECTION_NAME);
        }
        if (domIterables[COLLECTION_NAME]) for (var METHOD_NAME in es_array_iterator) {
          // some Chrome versions have non-configurable methods on DOMTokenList
          if (CollectionPrototype[METHOD_NAME] !== es_array_iterator[METHOD_NAME]) try {
            createNonEnumerableProperty(CollectionPrototype, METHOD_NAME, es_array_iterator[METHOD_NAME]);
          } catch (error) {
            CollectionPrototype[METHOD_NAME] = es_array_iterator[METHOD_NAME];
          }
        }
      }
    }

    function _arrayWithoutHoles(arr) {
      if (Array.isArray(arr)) {
        for (var i = 0, arr2 = new Array(arr.length); i < arr.length; i++) {
          arr2[i] = arr[i];
        }

        return arr2;
      }
    }

    function _iterableToArray(iter) {
      if (Symbol.iterator in Object(iter) || Object.prototype.toString.call(iter) === "[object Arguments]") return Array.from(iter);
    }

    function _nonIterableSpread() {
      throw new TypeError("Invalid attempt to spread non-iterable instance");
    }

    function _toConsumableArray(arr) {
      return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _nonIterableSpread();
    }

    var methods = {};
    var names = [];
    function registerMethods(name, m) {
      if (Array.isArray(name)) {
        var _iteratorNormalCompletion = true;
        var _didIteratorError = false;
        var _iteratorError = undefined;

        try {
          for (var _iterator = name[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
            var _name = _step.value;
            registerMethods(_name, m);
          }
        } catch (err) {
          _didIteratorError = true;
          _iteratorError = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion && _iterator.return != null) {
              _iterator.return();
            }
          } finally {
            if (_didIteratorError) {
              throw _iteratorError;
            }
          }
        }

        return;
      }

      if (_typeof(name) === 'object') {
        for (var _name2 in name) {
          registerMethods(_name2, name[_name2]);
        }

        return;
      }

      addMethodNames(Object.getOwnPropertyNames(m));
      methods[name] = Object.assign(methods[name] || {}, m);
    }
    function getMethodsFor(name) {
      return methods[name] || {};
    }
    function getMethodNames() {
      return _toConsumableArray(new Set(names));
    }
    function addMethodNames(_names) {
      names.push.apply(names, _toConsumableArray(_names));
    }

    var $includes = arrayIncludes.includes;


    // `Array.prototype.includes` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.includes
    _export({ target: 'Array', proto: true }, {
      includes: function includes(el /* , fromIndex = 0 */) {
        return $includes(this, el, arguments.length > 1 ? arguments[1] : undefined);
      }
    });

    // https://tc39.github.io/ecma262/#sec-array.prototype-@@unscopables
    addToUnscopables('includes');

    // `RegExp.prototype.flags` getter implementation
    // https://tc39.github.io/ecma262/#sec-get-regexp.prototype.flags
    var regexpFlags = function () {
      var that = anObject(this);
      var result = '';
      if (that.global) result += 'g';
      if (that.ignoreCase) result += 'i';
      if (that.multiline) result += 'm';
      if (that.dotAll) result += 's';
      if (that.unicode) result += 'u';
      if (that.sticky) result += 'y';
      return result;
    };

    var nativeExec = RegExp.prototype.exec;
    // This always refers to the native implementation, because the
    // String#replace polyfill uses ./fix-regexp-well-known-symbol-logic.js,
    // which loads this file before patching the method.
    var nativeReplace = String.prototype.replace;

    var patchedExec = nativeExec;

    var UPDATES_LAST_INDEX_WRONG = (function () {
      var re1 = /a/;
      var re2 = /b*/g;
      nativeExec.call(re1, 'a');
      nativeExec.call(re2, 'a');
      return re1.lastIndex !== 0 || re2.lastIndex !== 0;
    })();

    // nonparticipating capturing group, copied from es5-shim's String#split patch.
    var NPCG_INCLUDED = /()??/.exec('')[1] !== undefined;

    var PATCH = UPDATES_LAST_INDEX_WRONG || NPCG_INCLUDED;

    if (PATCH) {
      patchedExec = function exec(str) {
        var re = this;
        var lastIndex, reCopy, match, i;

        if (NPCG_INCLUDED) {
          reCopy = new RegExp('^' + re.source + '$(?!\\s)', regexpFlags.call(re));
        }
        if (UPDATES_LAST_INDEX_WRONG) lastIndex = re.lastIndex;

        match = nativeExec.call(re, str);

        if (UPDATES_LAST_INDEX_WRONG && match) {
          re.lastIndex = re.global ? match.index + match[0].length : lastIndex;
        }
        if (NPCG_INCLUDED && match && match.length > 1) {
          // Fix browsers whose `exec` methods don't consistently return `undefined`
          // for NPCG, like IE8. NOTE: This doesn' work for /(.?)?/
          nativeReplace.call(match[0], reCopy, function () {
            for (i = 1; i < arguments.length - 2; i++) {
              if (arguments[i] === undefined) match[i] = undefined;
            }
          });
        }

        return match;
      };
    }

    var regexpExec = patchedExec;

    _export({ target: 'RegExp', proto: true, forced: /./.exec !== regexpExec }, {
      exec: regexpExec
    });

    var MATCH = wellKnownSymbol('match');

    // `IsRegExp` abstract operation
    // https://tc39.github.io/ecma262/#sec-isregexp
    var isRegexp = function (it) {
      var isRegExp;
      return isObject(it) && ((isRegExp = it[MATCH]) !== undefined ? !!isRegExp : classofRaw(it) == 'RegExp');
    };

    var notARegexp = function (it) {
      if (isRegexp(it)) {
        throw TypeError("The method doesn't accept regular expressions");
      } return it;
    };

    var MATCH$1 = wellKnownSymbol('match');

    var correctIsRegexpLogic = function (METHOD_NAME) {
      var regexp = /./;
      try {
        '/./'[METHOD_NAME](regexp);
      } catch (e) {
        try {
          regexp[MATCH$1] = false;
          return '/./'[METHOD_NAME](regexp);
        } catch (f) { /* empty */ }
      } return false;
    };

    // `String.prototype.includes` method
    // https://tc39.github.io/ecma262/#sec-string.prototype.includes
    _export({ target: 'String', proto: true, forced: !correctIsRegexpLogic('includes') }, {
      includes: function includes(searchString /* , position = 0 */) {
        return !!~String(requireObjectCoercible(this))
          .indexOf(notARegexp(searchString), arguments.length > 1 ? arguments[1] : undefined);
      }
    });

    var SPECIES$4 = wellKnownSymbol('species');

    var REPLACE_SUPPORTS_NAMED_GROUPS = !fails(function () {
      // #replace needs built-in support for named groups.
      // #match works fine because it just return the exec results, even if it has
      // a "grops" property.
      var re = /./;
      re.exec = function () {
        var result = [];
        result.groups = { a: '7' };
        return result;
      };
      return ''.replace(re, '$<a>') !== '7';
    });

    // Chrome 51 has a buggy "split" implementation when RegExp#exec !== nativeExec
    // Weex JS has frozen built-in prototypes, so use try / catch wrapper
    var SPLIT_WORKS_WITH_OVERWRITTEN_EXEC = !fails(function () {
      var re = /(?:)/;
      var originalExec = re.exec;
      re.exec = function () { return originalExec.apply(this, arguments); };
      var result = 'ab'.split(re);
      return result.length !== 2 || result[0] !== 'a' || result[1] !== 'b';
    });

    var fixRegexpWellKnownSymbolLogic = function (KEY, length, exec, sham) {
      var SYMBOL = wellKnownSymbol(KEY);

      var DELEGATES_TO_SYMBOL = !fails(function () {
        // String methods call symbol-named RegEp methods
        var O = {};
        O[SYMBOL] = function () { return 7; };
        return ''[KEY](O) != 7;
      });

      var DELEGATES_TO_EXEC = DELEGATES_TO_SYMBOL && !fails(function () {
        // Symbol-named RegExp methods call .exec
        var execCalled = false;
        var re = /a/;

        if (KEY === 'split') {
          // We can't use real regex here since it causes deoptimization
          // and serious performance degradation in V8
          // https://github.com/zloirock/core-js/issues/306
          re = {};
          // RegExp[@@split] doesn't call the regex's exec method, but first creates
          // a new one. We need to return the patched regex when creating the new one.
          re.constructor = {};
          re.constructor[SPECIES$4] = function () { return re; };
          re.flags = '';
          re[SYMBOL] = /./[SYMBOL];
        }

        re.exec = function () { execCalled = true; return null; };

        re[SYMBOL]('');
        return !execCalled;
      });

      if (
        !DELEGATES_TO_SYMBOL ||
        !DELEGATES_TO_EXEC ||
        (KEY === 'replace' && !REPLACE_SUPPORTS_NAMED_GROUPS) ||
        (KEY === 'split' && !SPLIT_WORKS_WITH_OVERWRITTEN_EXEC)
      ) {
        var nativeRegExpMethod = /./[SYMBOL];
        var methods = exec(SYMBOL, ''[KEY], function (nativeMethod, regexp, str, arg2, forceStringMethod) {
          if (regexp.exec === regexpExec) {
            if (DELEGATES_TO_SYMBOL && !forceStringMethod) {
              // The native String method already delegates to @@method (this
              // polyfilled function), leasing to infinite recursion.
              // We avoid it by directly calling the native @@method method.
              return { done: true, value: nativeRegExpMethod.call(regexp, str, arg2) };
            }
            return { done: true, value: nativeMethod.call(str, regexp, arg2) };
          }
          return { done: false };
        });
        var stringMethod = methods[0];
        var regexMethod = methods[1];

        redefine(String.prototype, KEY, stringMethod);
        redefine(RegExp.prototype, SYMBOL, length == 2
          // 21.2.5.8 RegExp.prototype[@@replace](string, replaceValue)
          // 21.2.5.11 RegExp.prototype[@@split](string, limit)
          ? function (string, arg) { return regexMethod.call(string, this, arg); }
          // 21.2.5.6 RegExp.prototype[@@match](string)
          // 21.2.5.9 RegExp.prototype[@@search](string)
          : function (string) { return regexMethod.call(string, this); }
        );
        if (sham) createNonEnumerableProperty(RegExp.prototype[SYMBOL], 'sham', true);
      }
    };

    var charAt$1 = stringMultibyte.charAt;

    // `AdvanceStringIndex` abstract operation
    // https://tc39.github.io/ecma262/#sec-advancestringindex
    var advanceStringIndex = function (S, index, unicode) {
      return index + (unicode ? charAt$1(S, index).length : 1);
    };

    // `RegExpExec` abstract operation
    // https://tc39.github.io/ecma262/#sec-regexpexec
    var regexpExecAbstract = function (R, S) {
      var exec = R.exec;
      if (typeof exec === 'function') {
        var result = exec.call(R, S);
        if (typeof result !== 'object') {
          throw TypeError('RegExp exec method returned something other than an Object or null');
        }
        return result;
      }

      if (classofRaw(R) !== 'RegExp') {
        throw TypeError('RegExp#exec called on incompatible receiver');
      }

      return regexpExec.call(R, S);
    };

    var max$2 = Math.max;
    var min$2 = Math.min;
    var floor$1 = Math.floor;
    var SUBSTITUTION_SYMBOLS = /\$([$&'`]|\d\d?|<[^>]*>)/g;
    var SUBSTITUTION_SYMBOLS_NO_NAMED = /\$([$&'`]|\d\d?)/g;

    var maybeToString = function (it) {
      return it === undefined ? it : String(it);
    };

    // @@replace logic
    fixRegexpWellKnownSymbolLogic('replace', 2, function (REPLACE, nativeReplace, maybeCallNative) {
      return [
        // `String.prototype.replace` method
        // https://tc39.github.io/ecma262/#sec-string.prototype.replace
        function replace(searchValue, replaceValue) {
          var O = requireObjectCoercible(this);
          var replacer = searchValue == undefined ? undefined : searchValue[REPLACE];
          return replacer !== undefined
            ? replacer.call(searchValue, O, replaceValue)
            : nativeReplace.call(String(O), searchValue, replaceValue);
        },
        // `RegExp.prototype[@@replace]` method
        // https://tc39.github.io/ecma262/#sec-regexp.prototype-@@replace
        function (regexp, replaceValue) {
          var res = maybeCallNative(nativeReplace, regexp, this, replaceValue);
          if (res.done) return res.value;

          var rx = anObject(regexp);
          var S = String(this);

          var functionalReplace = typeof replaceValue === 'function';
          if (!functionalReplace) replaceValue = String(replaceValue);

          var global = rx.global;
          if (global) {
            var fullUnicode = rx.unicode;
            rx.lastIndex = 0;
          }
          var results = [];
          while (true) {
            var result = regexpExecAbstract(rx, S);
            if (result === null) break;

            results.push(result);
            if (!global) break;

            var matchStr = String(result[0]);
            if (matchStr === '') rx.lastIndex = advanceStringIndex(S, toLength(rx.lastIndex), fullUnicode);
          }

          var accumulatedResult = '';
          var nextSourcePosition = 0;
          for (var i = 0; i < results.length; i++) {
            result = results[i];

            var matched = String(result[0]);
            var position = max$2(min$2(toInteger(result.index), S.length), 0);
            var captures = [];
            // NOTE: This is equivalent to
            //   captures = result.slice(1).map(maybeToString)
            // but for some reason `nativeSlice.call(result, 1, result.length)` (called in
            // the slice polyfill when slicing native arrays) "doesn't work" in safari 9 and
            // causes a crash (https://pastebin.com/N21QzeQA) when trying to debug it.
            for (var j = 1; j < result.length; j++) captures.push(maybeToString(result[j]));
            var namedCaptures = result.groups;
            if (functionalReplace) {
              var replacerArgs = [matched].concat(captures, position, S);
              if (namedCaptures !== undefined) replacerArgs.push(namedCaptures);
              var replacement = String(replaceValue.apply(undefined, replacerArgs));
            } else {
              replacement = getSubstitution(matched, S, position, captures, namedCaptures, replaceValue);
            }
            if (position >= nextSourcePosition) {
              accumulatedResult += S.slice(nextSourcePosition, position) + replacement;
              nextSourcePosition = position + matched.length;
            }
          }
          return accumulatedResult + S.slice(nextSourcePosition);
        }
      ];

      // https://tc39.github.io/ecma262/#sec-getsubstitution
      function getSubstitution(matched, str, position, captures, namedCaptures, replacement) {
        var tailPos = position + matched.length;
        var m = captures.length;
        var symbols = SUBSTITUTION_SYMBOLS_NO_NAMED;
        if (namedCaptures !== undefined) {
          namedCaptures = toObject(namedCaptures);
          symbols = SUBSTITUTION_SYMBOLS;
        }
        return nativeReplace.call(replacement, symbols, function (match, ch) {
          var capture;
          switch (ch.charAt(0)) {
            case '$': return '$';
            case '&': return matched;
            case '`': return str.slice(0, position);
            case "'": return str.slice(tailPos);
            case '<':
              capture = namedCaptures[ch.slice(1, -1)];
              break;
            default: // \d\d?
              var n = +ch;
              if (n === 0) return match;
              if (n > m) {
                var f = floor$1(n / 10);
                if (f === 0) return match;
                if (f <= m) return captures[f - 1] === undefined ? ch.charAt(1) : captures[f - 1] + ch.charAt(1);
                return match;
              }
              capture = captures[n - 1];
          }
          return capture === undefined ? '' : capture;
        });
      }
    });

    // a string of all valid unicode whitespaces
    // eslint-disable-next-line max-len
    var whitespaces = '\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\u2028\u2029\uFEFF';

    var whitespace = '[' + whitespaces + ']';
    var ltrim = RegExp('^' + whitespace + whitespace + '*');
    var rtrim = RegExp(whitespace + whitespace + '*$');

    // `String.prototype.{ trim, trimStart, trimEnd, trimLeft, trimRight }` methods implementation
    var createMethod$3 = function (TYPE) {
      return function ($this) {
        var string = String(requireObjectCoercible($this));
        if (TYPE & 1) string = string.replace(ltrim, '');
        if (TYPE & 2) string = string.replace(rtrim, '');
        return string;
      };
    };

    var stringTrim = {
      // `String.prototype.{ trimLeft, trimStart }` methods
      // https://tc39.github.io/ecma262/#sec-string.prototype.trimstart
      start: createMethod$3(1),
      // `String.prototype.{ trimRight, trimEnd }` methods
      // https://tc39.github.io/ecma262/#sec-string.prototype.trimend
      end: createMethod$3(2),
      // `String.prototype.trim` method
      // https://tc39.github.io/ecma262/#sec-string.prototype.trim
      trim: createMethod$3(3)
    };

    var non = '\u200B\u0085\u180E';

    // check that a method works with the correct list
    // of whitespaces and has a correct name
    var forcedStringTrimMethod = function (METHOD_NAME) {
      return fails(function () {
        return !!whitespaces[METHOD_NAME]() || non[METHOD_NAME]() != non || whitespaces[METHOD_NAME].name !== METHOD_NAME;
      });
    };

    var $trim = stringTrim.trim;


    // `String.prototype.trim` method
    // https://tc39.github.io/ecma262/#sec-string.prototype.trim
    _export({ target: 'String', proto: true, forced: forcedStringTrimMethod('trim') }, {
      trim: function trim() {
        return $trim(this);
      }
    });

    // Map function
    function map(array, block) {
      var i;
      var il = array.length;
      var result = [];

      for (i = 0; i < il; i++) {
        result.push(block(array[i]));
      }

      return result;
    } // Filter function

    function radians(d) {
      return d % 360 * Math.PI / 180;
    } // Radians to degrees

    function camelCase(s) {
      return s.toLowerCase().replace(/-(.)/g, function (m, g) {
        return g.toUpperCase();
      });
    } // Convert camel cased string to string seperated

    function unCamelCase(s) {
      return s.replace(/([A-Z])/g, function (m, g) {
        return '-' + g.toLowerCase();
      });
    } // Capitalize first letter of a string

    function capitalize(s) {
      return s.charAt(0).toUpperCase() + s.slice(1);
    } // Calculate proportional width and height values when necessary

    function proportionalSize(element, width, height, box) {
      if (width == null || height == null) {
        box = box || element.bbox();

        if (width == null) {
          width = box.width / box.height * height;
        } else if (height == null) {
          height = box.height / box.width * width;
        }
      }

      return {
        width: width,
        height: height
      };
    }
    function getOrigin(o, element) {
      // Allow origin or around as the names
      var origin = o.origin; // o.around == null ? o.origin : o.around

      var ox, oy; // Allow the user to pass a string to rotate around a given point

      if (typeof origin === 'string' || origin == null) {
        // Get the bounding box of the element with no transformations applied
        var string = (origin || 'center').toLowerCase().trim();

        var _element$bbox = element.bbox(),
            height = _element$bbox.height,
            width = _element$bbox.width,
            x = _element$bbox.x,
            y = _element$bbox.y; // Calculate the transformed x and y coordinates


        var bx = string.includes('left') ? x : string.includes('right') ? x + width : x + width / 2;
        var by = string.includes('top') ? y : string.includes('bottom') ? y + height : y + height / 2; // Set the bounds eg : "bottom-left", "Top right", "middle" etc...

        ox = o.ox != null ? o.ox : bx;
        oy = o.oy != null ? o.oy : by;
      } else {
        ox = origin[0];
        oy = origin[1];
      } // Return the origin as it is if it wasn't a string


      return [ox, oy];
    }

    // Default namespaces
    var ns = 'http://www.w3.org/2000/svg';
    var xmlns = 'http://www.w3.org/2000/xmlns/';
    var xlink = 'http://www.w3.org/1999/xlink';
    var svgjs = 'http://svgjs.com/svgjs';

    var globals$1 = {
      window: typeof window === 'undefined' ? null : window,
      document: typeof document === 'undefined' ? null : document
    };

    function _classCallCheck(instance, Constructor) {
      if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
      }
    }

    var Base = function Base() {
      _classCallCheck(this, Base);
    };

    var elements = {};
    var root = '___SYMBOL___ROOT___'; // Method for element creation

    function create(name) {
      // create element
      return globals$1.document.createElementNS(ns, name);
    }
    function makeInstance(element) {
      if (element instanceof Base) return element;

      if (_typeof(element) === 'object') {
        return adopter(element);
      }

      if (element == null) {
        return new elements[root]();
      }

      if (typeof element === 'string' && element.charAt(0) !== '<') {
        return adopter(globals$1.document.querySelector(element));
      }

      var node = create('svg');
      node.innerHTML = element; // We can use firstChild here because we know,
      // that the first char is < and thus an element

      element = adopter(node.firstChild);
      return element;
    }
    function nodeOrNew(name, node) {
      return node instanceof globals$1.window.Node ? node : create(name);
    } // Adopt existing svg elements

    function adopt(node) {
      // check for presence of node
      if (!node) return null; // make sure a node isn't already adopted

      if (node.instance instanceof Base) return node.instance; // initialize variables

      var className = capitalize(node.nodeName || 'Dom'); // Make sure that gradients are adopted correctly

      if (className === 'LinearGradient' || className === 'RadialGradient') {
        className = 'Gradient'; // Fallback to Dom if element is not known
      } else if (!elements[className]) {
        className = 'Dom';
      }

      return new elements[className](node);
    }
    var adopter = adopt;
    function register(element) {
      var name = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : element.name;
      var asRoot = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;
      elements[name] = element;
      if (asRoot) elements[root] = element;
      addMethodNames(Object.getOwnPropertyNames(element.prototype));
      return element;
    }
    function getClass(name) {
      return elements[name];
    } // Element id sequence

    var did = 1000; // Get next named element id

    function eid(name) {
      return 'Svgjs' + capitalize(name) + did++;
    } // Deep new id assignment

    function assignNewId(node) {
      // do the same for SVG child nodes as well
      for (var i = node.children.length - 1; i >= 0; i--) {
        assignNewId(node.children[i]);
      }

      if (node.id) {
        return adopt(node).id(eid(node.nodeName));
      }

      return adopt(node);
    } // Method for extending objects

    function extend(modules, methods, attrCheck) {
      var key, i;
      modules = Array.isArray(modules) ? modules : [modules];

      for (i = modules.length - 1; i >= 0; i--) {
        for (key in methods) {
          var method = methods[key];

          if (attrCheck) {
            method = wrapWithAttrCheck(methods[key]);
          }

          modules[i].prototype[key] = method;
        }
      }
    } // export function extendWithAttrCheck (...args) {
    //   extend(...args, true)
    // }

    function wrapWithAttrCheck(fn) {
      return function () {
        for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
          args[_key] = arguments[_key];
        }

        var o = args[args.length - 1];

        if (o && o.constructor === Object && !(o instanceof Array)) {
          return fn.apply(this, args.slice(0, -1)).attr(o);
        } else {
          return fn.apply(this, args);
        }
      };
    }

    function siblings() {
      return this.parent().children();
    } // Get the curent position siblings

    function position() {
      return this.parent().index(this);
    } // Get the next element (will return null if there is none)

    function next() {
      return this.siblings()[this.position() + 1];
    } // Get the next element (will return null if there is none)

    function prev() {
      return this.siblings()[this.position() - 1];
    } // Send given element one step forward

    function forward() {
      var i = this.position() + 1;
      var p = this.parent(); // move node one step forward

      p.removeElement(this).add(this, i); // make sure defs node is always at the top

      if (typeof p.isRoot === 'function' && p.isRoot()) {
        p.node.appendChild(p.defs().node);
      }

      return this;
    } // Send given element one step backward

    function backward() {
      var i = this.position();

      if (i > 0) {
        this.parent().removeElement(this).add(this, i - 1);
      }

      return this;
    } // Send given element all the way to the front

    function front() {
      var p = this.parent(); // Move node forward

      p.node.appendChild(this.node); // Make sure defs node is always at the top

      if (typeof p.isRoot === 'function' && p.isRoot()) {
        p.node.appendChild(p.defs().node);
      }

      return this;
    } // Send given element all the way to the back

    function back() {
      if (this.position() > 0) {
        this.parent().removeElement(this).add(this, 0);
      }

      return this;
    } // Inserts a given element before the targeted element

    function before(element) {
      element = makeInstance(element);
      element.remove();
      var i = this.position();
      this.parent().add(element, i);
      return this;
    } // Inserts a given element after the targeted element

    function after(element) {
      element = makeInstance(element);
      element.remove();
      var i = this.position();
      this.parent().add(element, i + 1);
      return this;
    }
    function insertBefore(element) {
      element = makeInstance(element);
      element.before(this);
      return this;
    }
    function insertAfter(element) {
      element = makeInstance(element);
      element.after(this);
      return this;
    }
    registerMethods('Dom', {
      siblings: siblings,
      position: position,
      next: next,
      prev: prev,
      forward: forward,
      backward: backward,
      front: front,
      back: back,
      before: before,
      after: after,
      insertBefore: insertBefore,
      insertAfter: insertAfter
    });

    var $filter = arrayIteration.filter;


    // `Array.prototype.filter` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.filter
    // with adding support of @@species
    _export({ target: 'Array', proto: true, forced: !arrayMethodHasSpeciesSupport('filter') }, {
      filter: function filter(callbackfn /* , thisArg */) {
        return $filter(this, callbackfn, arguments.length > 1 ? arguments[1] : undefined);
      }
    });

    var sloppyArrayMethod = function (METHOD_NAME, argument) {
      var method = [][METHOD_NAME];
      return !method || !fails(function () {
        // eslint-disable-next-line no-useless-call,no-throw-literal
        method.call(null, argument || function () { throw 1; }, 1);
      });
    };

    var $indexOf = arrayIncludes.indexOf;


    var nativeIndexOf = [].indexOf;

    var NEGATIVE_ZERO = !!nativeIndexOf && 1 / [1].indexOf(1, -0) < 0;
    var SLOPPY_METHOD = sloppyArrayMethod('indexOf');

    // `Array.prototype.indexOf` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.indexof
    _export({ target: 'Array', proto: true, forced: NEGATIVE_ZERO || SLOPPY_METHOD }, {
      indexOf: function indexOf(searchElement /* , fromIndex = 0 */) {
        return NEGATIVE_ZERO
          // convert -0 to +0
          ? nativeIndexOf.apply(this, arguments) || 0
          : $indexOf(this, searchElement, arguments.length > 1 ? arguments[1] : undefined);
      }
    });

    var nativeJoin = [].join;

    var ES3_STRINGS = indexedObject != Object;
    var SLOPPY_METHOD$1 = sloppyArrayMethod('join', ',');

    // `Array.prototype.join` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.join
    _export({ target: 'Array', proto: true, forced: ES3_STRINGS || SLOPPY_METHOD$1 }, {
      join: function join(separator) {
        return nativeJoin.call(toIndexedObject(this), separator === undefined ? ',' : separator);
      }
    });

    var SPECIES$5 = wellKnownSymbol('species');

    // `SpeciesConstructor` abstract operation
    // https://tc39.github.io/ecma262/#sec-speciesconstructor
    var speciesConstructor = function (O, defaultConstructor) {
      var C = anObject(O).constructor;
      var S;
      return C === undefined || (S = anObject(C)[SPECIES$5]) == undefined ? defaultConstructor : aFunction$1(S);
    };

    var arrayPush = [].push;
    var min$3 = Math.min;
    var MAX_UINT32 = 0xFFFFFFFF;

    // babel-minify transpiles RegExp('x', 'y') -> /x/y and it causes SyntaxError
    var SUPPORTS_Y = !fails(function () { return !RegExp(MAX_UINT32, 'y'); });

    // @@split logic
    fixRegexpWellKnownSymbolLogic('split', 2, function (SPLIT, nativeSplit, maybeCallNative) {
      var internalSplit;
      if (
        'abbc'.split(/(b)*/)[1] == 'c' ||
        'test'.split(/(?:)/, -1).length != 4 ||
        'ab'.split(/(?:ab)*/).length != 2 ||
        '.'.split(/(.?)(.?)/).length != 4 ||
        '.'.split(/()()/).length > 1 ||
        ''.split(/.?/).length
      ) {
        // based on es5-shim implementation, need to rework it
        internalSplit = function (separator, limit) {
          var string = String(requireObjectCoercible(this));
          var lim = limit === undefined ? MAX_UINT32 : limit >>> 0;
          if (lim === 0) return [];
          if (separator === undefined) return [string];
          // If `separator` is not a regex, use native split
          if (!isRegexp(separator)) {
            return nativeSplit.call(string, separator, lim);
          }
          var output = [];
          var flags = (separator.ignoreCase ? 'i' : '') +
                      (separator.multiline ? 'm' : '') +
                      (separator.unicode ? 'u' : '') +
                      (separator.sticky ? 'y' : '');
          var lastLastIndex = 0;
          // Make `global` and avoid `lastIndex` issues by working with a copy
          var separatorCopy = new RegExp(separator.source, flags + 'g');
          var match, lastIndex, lastLength;
          while (match = regexpExec.call(separatorCopy, string)) {
            lastIndex = separatorCopy.lastIndex;
            if (lastIndex > lastLastIndex) {
              output.push(string.slice(lastLastIndex, match.index));
              if (match.length > 1 && match.index < string.length) arrayPush.apply(output, match.slice(1));
              lastLength = match[0].length;
              lastLastIndex = lastIndex;
              if (output.length >= lim) break;
            }
            if (separatorCopy.lastIndex === match.index) separatorCopy.lastIndex++; // Avoid an infinite loop
          }
          if (lastLastIndex === string.length) {
            if (lastLength || !separatorCopy.test('')) output.push('');
          } else output.push(string.slice(lastLastIndex));
          return output.length > lim ? output.slice(0, lim) : output;
        };
      // Chakra, V8
      } else if ('0'.split(undefined, 0).length) {
        internalSplit = function (separator, limit) {
          return separator === undefined && limit === 0 ? [] : nativeSplit.call(this, separator, limit);
        };
      } else internalSplit = nativeSplit;

      return [
        // `String.prototype.split` method
        // https://tc39.github.io/ecma262/#sec-string.prototype.split
        function split(separator, limit) {
          var O = requireObjectCoercible(this);
          var splitter = separator == undefined ? undefined : separator[SPLIT];
          return splitter !== undefined
            ? splitter.call(separator, O, limit)
            : internalSplit.call(String(O), separator, limit);
        },
        // `RegExp.prototype[@@split]` method
        // https://tc39.github.io/ecma262/#sec-regexp.prototype-@@split
        //
        // NOTE: This cannot be properly polyfilled in engines that don't support
        // the 'y' flag.
        function (regexp, limit) {
          var res = maybeCallNative(internalSplit, regexp, this, limit, internalSplit !== nativeSplit);
          if (res.done) return res.value;

          var rx = anObject(regexp);
          var S = String(this);
          var C = speciesConstructor(rx, RegExp);

          var unicodeMatching = rx.unicode;
          var flags = (rx.ignoreCase ? 'i' : '') +
                      (rx.multiline ? 'm' : '') +
                      (rx.unicode ? 'u' : '') +
                      (SUPPORTS_Y ? 'y' : 'g');

          // ^(? + rx + ) is needed, in combination with some S slicing, to
          // simulate the 'y' flag.
          var splitter = new C(SUPPORTS_Y ? rx : '^(?:' + rx.source + ')', flags);
          var lim = limit === undefined ? MAX_UINT32 : limit >>> 0;
          if (lim === 0) return [];
          if (S.length === 0) return regexpExecAbstract(splitter, S) === null ? [S] : [];
          var p = 0;
          var q = 0;
          var A = [];
          while (q < S.length) {
            splitter.lastIndex = SUPPORTS_Y ? q : 0;
            var z = regexpExecAbstract(splitter, SUPPORTS_Y ? S : S.slice(q));
            var e;
            if (
              z === null ||
              (e = min$3(toLength(splitter.lastIndex + (SUPPORTS_Y ? 0 : q)), S.length)) === p
            ) {
              q = advanceStringIndex(S, q, unicodeMatching);
            } else {
              A.push(S.slice(p, q));
              if (A.length === lim) return A;
              for (var i = 1; i <= z.length - 1; i++) {
                A.push(z[i]);
                if (A.length === lim) return A;
              }
              q = p = e;
            }
          }
          A.push(S.slice(p));
          return A;
        }
      ];
    }, !SUPPORTS_Y);

    // Parse unit value
    var numberAndUnit = /^([+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?)([a-z%]*)$/i; // Parse hex value

    var hex = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i; // Parse rgb value

    var rgb = /rgb\((\d+),(\d+),(\d+)\)/; // Parse reference id

    var reference = /(#[a-z0-9\-_]+)/i; // splits a transformation chain

    var transforms = /\)\s*,?\s*/; // Whitespace

    var whitespace$1 = /\s/g; // Test hex value

    var isHex = /^#[a-f0-9]{3,6}$/i; // Test rgb value

    var isRgb = /^rgb\(/; // Test css declaration

    var isBlank = /^(\s+)?$/; // Test for numeric string

    var isNumber = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i; // Test for percent value

    var isImage = /\.(jpg|jpeg|png|gif|svg)(\?[^=]+.*)?/i; // split at whitespace and comma

    var delimiter = /[\s,]+/; // The following regex are used to parse the d attribute of a path
    // Matches all hyphens which are not after an exponent

    var hyphen = /([^e])-/gi; // Replaces and tests for all path letters

    var pathLetters = /[MLHVCSQTAZ]/gi; // yes we need this one, too

    var isPathLetter = /[MLHVCSQTAZ]/i; // matches 0.154.23.45

    var numbersWithDots = /((\d?\.\d+(?:e[+-]?\d+)?)((?:\.\d+(?:e[+-]?\d+)?)+))+/gi; // matches .

    var dots = /\./g;

    function classes() {
      var attr = this.attr('class');
      return attr == null ? [] : attr.trim().split(delimiter);
    } // Return true if class exists on the node, false otherwise

    function hasClass(name) {
      return this.classes().indexOf(name) !== -1;
    } // Add class to the node

    function addClass(name) {
      if (!this.hasClass(name)) {
        var array = this.classes();
        array.push(name);
        this.attr('class', array.join(' '));
      }

      return this;
    } // Remove class from the node

    function removeClass(name) {
      if (this.hasClass(name)) {
        this.attr('class', this.classes().filter(function (c) {
          return c !== name;
        }).join(' '));
      }

      return this;
    } // Toggle the presence of a class on the node

    function toggleClass(name) {
      return this.hasClass(name) ? this.removeClass(name) : this.addClass(name);
    }
    registerMethods('Dom', {
      classes: classes,
      hasClass: hasClass,
      addClass: addClass,
      removeClass: removeClass,
      toggleClass: toggleClass
    });

    var $forEach$1 = arrayIteration.forEach;


    // `Array.prototype.forEach` method implementation
    // https://tc39.github.io/ecma262/#sec-array.prototype.foreach
    var arrayForEach = sloppyArrayMethod('forEach') ? function forEach(callbackfn /* , thisArg */) {
      return $forEach$1(this, callbackfn, arguments.length > 1 ? arguments[1] : undefined);
    } : [].forEach;

    // `Array.prototype.forEach` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.foreach
    _export({ target: 'Array', proto: true, forced: [].forEach != arrayForEach }, {
      forEach: arrayForEach
    });

    for (var COLLECTION_NAME$1 in domIterables) {
      var Collection$1 = global_1[COLLECTION_NAME$1];
      var CollectionPrototype$1 = Collection$1 && Collection$1.prototype;
      // some Chrome versions have non-configurable methods on DOMTokenList
      if (CollectionPrototype$1 && CollectionPrototype$1.forEach !== arrayForEach) try {
        createNonEnumerableProperty(CollectionPrototype$1, 'forEach', arrayForEach);
      } catch (error) {
        CollectionPrototype$1.forEach = arrayForEach;
      }
    }

    function css$1(style, val) {
      var ret = {};

      if (arguments.length === 0) {
        // get full style as object
        this.node.style.cssText.split(/\s*;\s*/).filter(function (el) {
          return !!el.length;
        }).forEach(function (el) {
          var t = el.split(/\s*:\s*/);
          ret[t[0]] = t[1];
        });
        return ret;
      }

      if (arguments.length < 2) {
        // get style properties in the array
        if (Array.isArray(style)) {
          var _iteratorNormalCompletion = true;
          var _didIteratorError = false;
          var _iteratorError = undefined;

          try {
            for (var _iterator = style[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
              var name = _step.value;
              var cased = camelCase(name);
              ret[cased] = this.node.style[cased];
            }
          } catch (err) {
            _didIteratorError = true;
            _iteratorError = err;
          } finally {
            try {
              if (!_iteratorNormalCompletion && _iterator.return != null) {
                _iterator.return();
              }
            } finally {
              if (_didIteratorError) {
                throw _iteratorError;
              }
            }
          }

          return ret;
        } // get style for property


        if (typeof style === 'string') {
          return this.node.style[camelCase(style)];
        } // set styles in object


        if (_typeof(style) === 'object') {
          for (var _name in style) {
            // set empty string if null/undefined/'' was given
            this.node.style[camelCase(_name)] = style[_name] == null || isBlank.test(style[_name]) ? '' : style[_name];
          }
        }
      } // set style for property


      if (arguments.length === 2) {
        this.node.style[camelCase(style)] = val == null || isBlank.test(val) ? '' : val;
      }

      return this;
    } // Show element

    function show() {
      return this.css('display', '');
    } // Hide element

    function hide() {
      return this.css('display', 'none');
    } // Is element visible?

    function visible() {
      return this.css('display') !== 'none';
    }
    registerMethods('Dom', {
      css: css$1,
      show: show,
      hide: hide,
      visible: visible
    });

    function data$1(a, v, r) {
      if (_typeof(a) === 'object') {
        for (v in a) {
          this.data(v, a[v]);
        }
      } else if (arguments.length < 2) {
        try {
          return JSON.parse(this.attr('data-' + a));
        } catch (e) {
          return this.attr('data-' + a);
        }
      } else {
        this.attr('data-' + a, v === null ? null : r === true || typeof v === 'string' || typeof v === 'number' ? v : JSON.stringify(v));
      }

      return this;
    }
    registerMethods('Dom', {
      data: data$1
    });

    function remember(k, v) {
      // remember every item in an object individually
      if (_typeof(arguments[0]) === 'object') {
        for (var key in k) {
          this.remember(key, k[key]);
        }
      } else if (arguments.length === 1) {
        // retrieve memory
        return this.memory()[k];
      } else {
        // store memory
        this.memory()[k] = v;
      }

      return this;
    } // Erase a given memory

    function forget() {
      if (arguments.length === 0) {
        this._memory = {};
      } else {
        for (var i = arguments.length - 1; i >= 0; i--) {
          delete this.memory()[arguments[i]];
        }
      }

      return this;
    } // This triggers creation of a new hidden class which is not performant
    // However, this function is not rarely used so it will not happen frequently
    // Return local memory object

    function memory() {
      return this._memory = this._memory || {};
    }
    registerMethods('Dom', {
      remember: remember,
      forget: forget,
      memory: memory
    });

    // `Array.prototype.{ reduce, reduceRight }` methods implementation
    var createMethod$4 = function (IS_RIGHT) {
      return function (that, callbackfn, argumentsLength, memo) {
        aFunction$1(callbackfn);
        var O = toObject(that);
        var self = indexedObject(O);
        var length = toLength(O.length);
        var index = IS_RIGHT ? length - 1 : 0;
        var i = IS_RIGHT ? -1 : 1;
        if (argumentsLength < 2) while (true) {
          if (index in self) {
            memo = self[index];
            index += i;
            break;
          }
          index += i;
          if (IS_RIGHT ? index < 0 : length <= index) {
            throw TypeError('Reduce of empty array with no initial value');
          }
        }
        for (;IS_RIGHT ? index >= 0 : length > index; index += i) if (index in self) {
          memo = callbackfn(memo, self[index], index, O);
        }
        return memo;
      };
    };

    var arrayReduce = {
      // `Array.prototype.reduce` method
      // https://tc39.github.io/ecma262/#sec-array.prototype.reduce
      left: createMethod$4(false),
      // `Array.prototype.reduceRight` method
      // https://tc39.github.io/ecma262/#sec-array.prototype.reduceright
      right: createMethod$4(true)
    };

    var $reduce = arrayReduce.left;


    // `Array.prototype.reduce` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.reduce
    _export({ target: 'Array', proto: true, forced: sloppyArrayMethod('reduce') }, {
      reduce: function reduce(callbackfn /* , initialValue */) {
        return $reduce(this, callbackfn, arguments.length, arguments.length > 1 ? arguments[1] : undefined);
      }
    });

    var listenerId = 0;
    var windowEvents = {};

    function getEvents(instance) {
      var n = instance.getEventHolder(); // We dont want to save events in global space

      if (n === globals$1.window) n = windowEvents;
      if (!n.events) n.events = {};
      return n.events;
    }

    function getEventTarget(instance) {
      return instance.getEventTarget();
    }

    function clearEvents(instance) {
      var n = instance.getEventHolder();
      if (n.events) n.events = {};
    } // Add event binder in the SVG namespace


    function on(node, events, listener, binding, options) {
      var l = listener.bind(binding || node);
      var instance = makeInstance(node);
      var bag = getEvents(instance);
      var n = getEventTarget(instance); // events can be an array of events or a string of events

      events = Array.isArray(events) ? events : events.split(delimiter); // add id to listener

      if (!listener._svgjsListenerId) {
        listener._svgjsListenerId = ++listenerId;
      }

      events.forEach(function (event) {
        var ev = event.split('.')[0];
        var ns = event.split('.')[1] || '*'; // ensure valid object

        bag[ev] = bag[ev] || {};
        bag[ev][ns] = bag[ev][ns] || {}; // reference listener

        bag[ev][ns][listener._svgjsListenerId] = l; // add listener

        n.addEventListener(ev, l, options || false);
      });
    } // Add event unbinder in the SVG namespace

    function off(node, events, listener, options) {
      var instance = makeInstance(node);
      var bag = getEvents(instance);
      var n = getEventTarget(instance); // listener can be a function or a number

      if (typeof listener === 'function') {
        listener = listener._svgjsListenerId;
        if (!listener) return;
      } // events can be an array of events or a string or undefined


      events = Array.isArray(events) ? events : (events || '').split(delimiter);
      events.forEach(function (event) {
        var ev = event && event.split('.')[0];
        var ns = event && event.split('.')[1];
        var namespace, l;

        if (listener) {
          // remove listener reference
          if (bag[ev] && bag[ev][ns || '*']) {
            // removeListener
            n.removeEventListener(ev, bag[ev][ns || '*'][listener], options || false);
            delete bag[ev][ns || '*'][listener];
          }
        } else if (ev && ns) {
          // remove all listeners for a namespaced event
          if (bag[ev] && bag[ev][ns]) {
            for (l in bag[ev][ns]) {
              off(n, [ev, ns].join('.'), l);
            }

            delete bag[ev][ns];
          }
        } else if (ns) {
          // remove all listeners for a specific namespace
          for (event in bag) {
            for (namespace in bag[event]) {
              if (ns === namespace) {
                off(n, [event, ns].join('.'));
              }
            }
          }
        } else if (ev) {
          // remove all listeners for the event
          if (bag[ev]) {
            for (namespace in bag[ev]) {
              off(n, [ev, namespace].join('.'));
            }

            delete bag[ev];
          }
        } else {
          // remove all listeners on a given node
          for (event in bag) {
            off(n, event);
          }

          clearEvents(instance);
        }
      });
    }
    function dispatch(node, event, data) {
      var n = getEventTarget(node); // Dispatch event

      if (event instanceof globals$1.window.Event) {
        n.dispatchEvent(event);
      } else {
        event = new globals$1.window.CustomEvent(event, {
          detail: data,
          cancelable: true
        });
        n.dispatchEvent(event);
      }

      return event;
    }

    var IS_CONCAT_SPREADABLE = wellKnownSymbol('isConcatSpreadable');
    var MAX_SAFE_INTEGER = 0x1FFFFFFFFFFFFF;
    var MAXIMUM_ALLOWED_INDEX_EXCEEDED = 'Maximum allowed index exceeded';

    // We can't use this feature detection in V8 since it causes
    // deoptimization and serious performance degradation
    // https://github.com/zloirock/core-js/issues/679
    var IS_CONCAT_SPREADABLE_SUPPORT = v8Version >= 51 || !fails(function () {
      var array = [];
      array[IS_CONCAT_SPREADABLE] = false;
      return array.concat()[0] !== array;
    });

    var SPECIES_SUPPORT = arrayMethodHasSpeciesSupport('concat');

    var isConcatSpreadable = function (O) {
      if (!isObject(O)) return false;
      var spreadable = O[IS_CONCAT_SPREADABLE];
      return spreadable !== undefined ? !!spreadable : isArray(O);
    };

    var FORCED = !IS_CONCAT_SPREADABLE_SUPPORT || !SPECIES_SUPPORT;

    // `Array.prototype.concat` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.concat
    // with adding support of @@isConcatSpreadable and @@species
    _export({ target: 'Array', proto: true, forced: FORCED }, {
      concat: function concat(arg) { // eslint-disable-line no-unused-vars
        var O = toObject(this);
        var A = arraySpeciesCreate(O, 0);
        var n = 0;
        var i, k, length, len, E;
        for (i = -1, length = arguments.length; i < length; i++) {
          E = i === -1 ? O : arguments[i];
          if (isConcatSpreadable(E)) {
            len = toLength(E.length);
            if (n + len > MAX_SAFE_INTEGER) throw TypeError(MAXIMUM_ALLOWED_INDEX_EXCEEDED);
            for (k = 0; k < len; k++, n++) if (k in E) createProperty(A, n, E[k]);
          } else {
            if (n >= MAX_SAFE_INTEGER) throw TypeError(MAXIMUM_ALLOWED_INDEX_EXCEEDED);
            createProperty(A, n++, E);
          }
        }
        A.length = n;
        return A;
      }
    });

    var $map = arrayIteration.map;


    // `Array.prototype.map` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.map
    // with adding support of @@species
    _export({ target: 'Array', proto: true, forced: !arrayMethodHasSpeciesSupport('map') }, {
      map: function map(callbackfn /* , thisArg */) {
        return $map(this, callbackfn, arguments.length > 1 ? arguments[1] : undefined);
      }
    });

    var DatePrototype = Date.prototype;
    var INVALID_DATE = 'Invalid Date';
    var TO_STRING = 'toString';
    var nativeDateToString = DatePrototype[TO_STRING];
    var getTime = DatePrototype.getTime;

    // `Date.prototype.toString` method
    // https://tc39.github.io/ecma262/#sec-date.prototype.tostring
    if (new Date(NaN) + '' != INVALID_DATE) {
      redefine(DatePrototype, TO_STRING, function toString() {
        var value = getTime.call(this);
        // eslint-disable-next-line no-self-compare
        return value === value ? nativeDateToString.call(this) : INVALID_DATE;
      });
    }

    var trim = stringTrim.trim;


    var nativeParseInt = global_1.parseInt;
    var hex$1 = /^[+-]?0[Xx]/;
    var FORCED$1 = nativeParseInt(whitespaces + '08') !== 8 || nativeParseInt(whitespaces + '0x16') !== 22;

    // `parseInt` method
    // https://tc39.github.io/ecma262/#sec-parseint-string-radix
    var _parseInt = FORCED$1 ? function parseInt(string, radix) {
      var S = trim(String(string));
      return nativeParseInt(S, (radix >>> 0) || (hex$1.test(S) ? 16 : 10));
    } : nativeParseInt;

    // `parseInt` method
    // https://tc39.github.io/ecma262/#sec-parseint-string-radix
    _export({ global: true, forced: parseInt != _parseInt }, {
      parseInt: _parseInt
    });

    var TO_STRING$1 = 'toString';
    var RegExpPrototype = RegExp.prototype;
    var nativeToString = RegExpPrototype[TO_STRING$1];

    var NOT_GENERIC = fails(function () { return nativeToString.call({ source: 'a', flags: 'b' }) != '/a/b'; });
    // FF44- RegExp#toString has a wrong name
    var INCORRECT_NAME = nativeToString.name != TO_STRING$1;

    // `RegExp.prototype.toString` method
    // https://tc39.github.io/ecma262/#sec-regexp.prototype.tostring
    if (NOT_GENERIC || INCORRECT_NAME) {
      redefine(RegExp.prototype, TO_STRING$1, function toString() {
        var R = anObject(this);
        var p = String(R.source);
        var rf = R.flags;
        var f = String(rf === undefined && R instanceof RegExp && !('flags' in RegExpPrototype) ? regexpFlags.call(R) : rf);
        return '/' + p + '/' + f;
      }, { unsafe: true });
    }

    function _arrayWithHoles(arr) {
      if (Array.isArray(arr)) return arr;
    }

    function _iterableToArrayLimit(arr, i) {
      if (!(Symbol.iterator in Object(arr) || Object.prototype.toString.call(arr) === "[object Arguments]")) {
        return;
      }

      var _arr = [];
      var _n = true;
      var _d = false;
      var _e = undefined;

      try {
        for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) {
          _arr.push(_s.value);

          if (i && _arr.length === i) break;
        }
      } catch (err) {
        _d = true;
        _e = err;
      } finally {
        try {
          if (!_n && _i["return"] != null) _i["return"]();
        } finally {
          if (_d) throw _e;
        }
      }

      return _arr;
    }

    function _nonIterableRest() {
      throw new TypeError("Invalid attempt to destructure non-iterable instance");
    }

    function _slicedToArray(arr, i) {
      return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _nonIterableRest();
    }

    function _defineProperties(target, props) {
      for (var i = 0; i < props.length; i++) {
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor) descriptor.writable = true;
        Object.defineProperty(target, descriptor.key, descriptor);
      }
    }

    function _createClass(Constructor, protoProps, staticProps) {
      if (protoProps) _defineProperties(Constructor.prototype, protoProps);
      if (staticProps) _defineProperties(Constructor, staticProps);
      return Constructor;
    }

    function sixDigitHex(hex) {
      return hex.length === 4 ? ['#', hex.substring(1, 2), hex.substring(1, 2), hex.substring(2, 3), hex.substring(2, 3), hex.substring(3, 4), hex.substring(3, 4)].join('') : hex;
    }

    function componentHex(component) {
      var integer = Math.round(component);
      var bounded = Math.max(0, Math.min(255, integer));
      var hex = bounded.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }

    function is(object, space) {
      for (var i = space.length; i--;) {
        if (object[space[i]] == null) {
          return false;
        }
      }

      return true;
    }

    function getParameters(a, b) {
      var params = is(a, 'rgb') ? {
        _a: a.r,
        _b: a.g,
        _c: a.b,
        space: 'rgb'
      } : is(a, 'xyz') ? {
        _a: a.x,
        _b: a.y,
        _c: a.z,
        _d: 0,
        space: 'xyz'
      } : is(a, 'hsl') ? {
        _a: a.h,
        _b: a.s,
        _c: a.l,
        _d: 0,
        space: 'hsl'
      } : is(a, 'lab') ? {
        _a: a.l,
        _b: a.a,
        _c: a.b,
        _d: 0,
        space: 'lab'
      } : is(a, 'lch') ? {
        _a: a.l,
        _b: a.c,
        _c: a.h,
        _d: 0,
        space: 'lch'
      } : is(a, 'cmyk') ? {
        _a: a.c,
        _b: a.m,
        _c: a.y,
        _d: a.k,
        space: 'cmyk'
      } : {
        _a: 0,
        _b: 0,
        _c: 0,
        space: 'rgb'
      };
      params.space = b || params.space;
      return params;
    }

    function cieSpace(space) {
      if (space === 'lab' || space === 'xyz' || space === 'lch') {
        return true;
      } else {
        return false;
      }
    }

    function hueToRgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }

    var Color =
    /*#__PURE__*/
    function () {
      function Color() {
        _classCallCheck(this, Color);

        this.init.apply(this, arguments);
      }

      _createClass(Color, [{
        key: "init",
        value: function init() {
          var a = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
          var b = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
          var c = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
          var d = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 0;
          var space = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : 'rgb';
          // This catches the case when a falsy value is passed like ''
          a = !a ? 0 : a; // Reset all values in case the init function is rerun with new color space

          if (this.space) {
            for (var component in this.space) {
              delete this[this.space[component]];
            }
          }

          if (typeof a === 'number') {
            // Allow for the case that we don't need d...
            space = typeof d === 'string' ? d : space;
            d = typeof d === 'string' ? 0 : d; // Assign the values straight to the color

            Object.assign(this, {
              _a: a,
              _b: b,
              _c: c,
              _d: d,
              space: space
            }); // If the user gave us an array, make the color from it
          } else if (a instanceof Array) {
            this.space = b || (typeof a[3] === 'string' ? a[3] : a[4]) || 'rgb';
            Object.assign(this, {
              _a: a[0],
              _b: a[1],
              _c: a[2],
              _d: a[3] || 0
            });
          } else if (a instanceof Object) {
            // Set the object up and assign its values directly
            var values = getParameters(a, b);
            Object.assign(this, values);
          } else if (typeof a === 'string') {
            if (isRgb.test(a)) {
              var noWhitespace = a.replace(whitespace$1, '');

              var _rgb$exec$slice$map = rgb.exec(noWhitespace).slice(1, 4).map(function (v) {
                return parseInt(v);
              }),
                  _rgb$exec$slice$map2 = _slicedToArray(_rgb$exec$slice$map, 3),
                  _a2 = _rgb$exec$slice$map2[0],
                  _b2 = _rgb$exec$slice$map2[1],
                  _c2 = _rgb$exec$slice$map2[2];

              Object.assign(this, {
                _a: _a2,
                _b: _b2,
                _c: _c2,
                _d: 0,
                space: 'rgb'
              });
            } else if (isHex.test(a)) {
              var hexParse = function hexParse(v) {
                return parseInt(v, 16);
              };

              var _hex$exec$map = hex.exec(sixDigitHex(a)).map(hexParse),
                  _hex$exec$map2 = _slicedToArray(_hex$exec$map, 4),
                  _a3 = _hex$exec$map2[1],
                  _b3 = _hex$exec$map2[2],
                  _c3 = _hex$exec$map2[3];

              Object.assign(this, {
                _a: _a3,
                _b: _b3,
                _c: _c3,
                _d: 0,
                space: 'rgb'
              });
            } else throw Error('Unsupported string format, can\'t construct Color');
          } // Now add the components as a convenience


          var _a = this._a,
              _b = this._b,
              _c = this._c,
              _d = this._d;
          var components = this.space === 'rgb' ? {
            r: _a,
            g: _b,
            b: _c
          } : this.space === 'xyz' ? {
            x: _a,
            y: _b,
            z: _c
          } : this.space === 'hsl' ? {
            h: _a,
            s: _b,
            l: _c
          } : this.space === 'lab' ? {
            l: _a,
            a: _b,
            b: _c
          } : this.space === 'lch' ? {
            l: _a,
            c: _b,
            h: _c
          } : this.space === 'cmyk' ? {
            c: _a,
            m: _b,
            y: _c,
            k: _d
          } : {};
          Object.assign(this, components);
        }
        /*
        Conversion Methods
        */

      }, {
        key: "rgb",
        value: function rgb() {
          if (this.space === 'rgb') {
            return this;
          } else if (cieSpace(this.space)) {
            // Convert to the xyz color space
            var x = this.x,
                y = this.y,
                z = this.z;

            if (this.space === 'lab' || this.space === 'lch') {
              // Get the values in the lab space
              var l = this.l,
                  a = this.a,
                  _b4 = this.b;

              if (this.space === 'lch') {
                var c = this.c,
                    h = this.h;
                var dToR = Math.PI / 180;
                a = c * Math.cos(dToR * h);
                _b4 = c * Math.sin(dToR * h);
              } // Undo the nonlinear function


              var yL = (l + 16) / 116;
              var xL = a / 500 + yL;
              var zL = yL - _b4 / 200; // Get the xyz values

              var ct = 16 / 116;
              var mx = 0.008856;
              var nm = 7.787;
              x = 0.95047 * (Math.pow(xL, 3) > mx ? Math.pow(xL, 3) : (xL - ct) / nm);
              y = 1.00000 * (Math.pow(yL, 3) > mx ? Math.pow(yL, 3) : (yL - ct) / nm);
              z = 1.08883 * (Math.pow(zL, 3) > mx ? Math.pow(zL, 3) : (zL - ct) / nm);
            } // Convert xyz to unbounded rgb values


            var rU = x * 3.2406 + y * -1.5372 + z * -0.4986;
            var gU = x * -0.9689 + y * 1.8758 + z * 0.0415;
            var bU = x * 0.0557 + y * -0.2040 + z * 1.0570; // Convert the values to true rgb values

            var pow = Math.pow;
            var bd = 0.0031308;
            var r = rU > bd ? 1.055 * pow(rU, 1 / 2.4) - 0.055 : 12.92 * rU;
            var g = gU > bd ? 1.055 * pow(gU, 1 / 2.4) - 0.055 : 12.92 * gU;
            var b = bU > bd ? 1.055 * pow(bU, 1 / 2.4) - 0.055 : 12.92 * bU; // Make and return the color

            var color = new Color(255 * r, 255 * g, 255 * b);
            return color;
          } else if (this.space === 'hsl') {
            // https://bgrins.github.io/TinyColor/docs/tinycolor.html
            // Get the current hsl values
            var _h = this.h,
                s = this.s,
                _l = this.l;
            _h /= 360;
            s /= 100;
            _l /= 100; // If we are grey, then just make the color directly

            if (s === 0) {
              _l *= 255;

              var _color2 = new Color(_l, _l, _l);

              return _color2;
            } // TODO I have no idea what this does :D If you figure it out, tell me!


            var q = _l < 0.5 ? _l * (1 + s) : _l + s - _l * s;
            var p = 2 * _l - q; // Get the rgb values

            var _r = 255 * hueToRgb(p, q, _h + 1 / 3);

            var _g = 255 * hueToRgb(p, q, _h);

            var _b5 = 255 * hueToRgb(p, q, _h - 1 / 3); // Make a new color


            var _color = new Color(_r, _g, _b5);

            return _color;
          } else if (this.space === 'cmyk') {
            // https://gist.github.com/felipesabino/5066336
            // Get the normalised cmyk values
            var _c4 = this.c,
                m = this.m,
                _y = this.y,
                k = this.k; // Get the rgb values

            var _r2 = 255 * (1 - Math.min(1, _c4 * (1 - k) + k));

            var _g2 = 255 * (1 - Math.min(1, m * (1 - k) + k));

            var _b6 = 255 * (1 - Math.min(1, _y * (1 - k) + k)); // Form the color and return it


            var _color3 = new Color(_r2, _g2, _b6);

            return _color3;
          } else {
            return this;
          }
        }
      }, {
        key: "lab",
        value: function lab() {
          // Get the xyz color
          var _this$xyz = this.xyz(),
              x = _this$xyz.x,
              y = _this$xyz.y,
              z = _this$xyz.z; // Get the lab components


          var l = 116 * y - 16;
          var a = 500 * (x - y);
          var b = 200 * (y - z); // Construct and return a new color

          var color = new Color(l, a, b, 'lab');
          return color;
        }
      }, {
        key: "xyz",
        value: function xyz() {
          // Normalise the red, green and blue values
          var _this$rgb = this.rgb(),
              r255 = _this$rgb._a,
              g255 = _this$rgb._b,
              b255 = _this$rgb._c;

          var _map = [r255, g255, b255].map(function (v) {
            return v / 255;
          }),
              _map2 = _slicedToArray(_map, 3),
              r = _map2[0],
              g = _map2[1],
              b = _map2[2]; // Convert to the lab rgb space


          var rL = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
          var gL = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
          var bL = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92; // Convert to the xyz color space without bounding the values

          var xU = (rL * 0.4124 + gL * 0.3576 + bL * 0.1805) / 0.95047;
          var yU = (rL * 0.2126 + gL * 0.7152 + bL * 0.0722) / 1.00000;
          var zU = (rL * 0.0193 + gL * 0.1192 + bL * 0.9505) / 1.08883; // Get the proper xyz values by applying the bounding

          var x = xU > 0.008856 ? Math.pow(xU, 1 / 3) : 7.787 * xU + 16 / 116;
          var y = yU > 0.008856 ? Math.pow(yU, 1 / 3) : 7.787 * yU + 16 / 116;
          var z = zU > 0.008856 ? Math.pow(zU, 1 / 3) : 7.787 * zU + 16 / 116; // Make and return the color

          var color = new Color(x, y, z, 'xyz');
          return color;
        }
      }, {
        key: "lch",
        value: function lch() {
          // Get the lab color directly
          var _this$lab = this.lab(),
              l = _this$lab.l,
              a = _this$lab.a,
              b = _this$lab.b; // Get the chromaticity and the hue using polar coordinates


          var c = Math.sqrt(Math.pow(a, 2) + Math.pow(b, 2));
          var h = 180 * Math.atan2(b, a) / Math.PI;

          if (h < 0) {
            h *= -1;
            h = 360 - h;
          } // Make a new color and return it


          var color = new Color(l, c, h, 'lch');
          return color;
        }
      }, {
        key: "hsl",
        value: function hsl() {
          // Get the rgb values
          var _this$rgb2 = this.rgb(),
              _a = _this$rgb2._a,
              _b = _this$rgb2._b,
              _c = _this$rgb2._c;

          var _map3 = [_a, _b, _c].map(function (v) {
            return v / 255;
          }),
              _map4 = _slicedToArray(_map3, 3),
              r = _map4[0],
              g = _map4[1],
              b = _map4[2]; // Find the maximum and minimum values to get the lightness


          var max = Math.max(r, g, b);
          var min = Math.min(r, g, b);
          var l = (max + min) / 2; // If the r, g, v values are identical then we are grey

          var isGrey = max === min; // Calculate the hue and saturation

          var delta = max - min;
          var s = isGrey ? 0 : l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
          var h = isGrey ? 0 : max === r ? ((g - b) / delta + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / delta + 2) / 6 : max === b ? ((r - g) / delta + 4) / 6 : 0; // Construct and return the new color

          var color = new Color(360 * h, 100 * s, 100 * l, 'hsl');
          return color;
        }
      }, {
        key: "cmyk",
        value: function cmyk() {
          // Get the rgb values for the current color
          var _this$rgb3 = this.rgb(),
              _a = _this$rgb3._a,
              _b = _this$rgb3._b,
              _c = _this$rgb3._c;

          var _map5 = [_a, _b, _c].map(function (v) {
            return v / 255;
          }),
              _map6 = _slicedToArray(_map5, 3),
              r = _map6[0],
              g = _map6[1],
              b = _map6[2]; // Get the cmyk values in an unbounded format


          var k = Math.min(1 - r, 1 - g, 1 - b);

          if (k === 1) {
            // Catch the black case
            return new Color(0, 0, 0, 1, 'cmyk');
          }

          var c = (1 - r - k) / (1 - k);
          var m = (1 - g - k) / (1 - k);
          var y = (1 - b - k) / (1 - k); // Construct the new color

          var color = new Color(c, m, y, k, 'cmyk');
          return color;
        }
        /*
        Input and Output methods
        */

      }, {
        key: "_clamped",
        value: function _clamped() {
          var _this$rgb4 = this.rgb(),
              _a = _this$rgb4._a,
              _b = _this$rgb4._b,
              _c = _this$rgb4._c;

          var max = Math.max,
              min = Math.min,
              round = Math.round;

          var format = function format(v) {
            return max(0, min(round(v), 255));
          };

          return [_a, _b, _c].map(format);
        }
      }, {
        key: "toHex",
        value: function toHex() {
          var _this$_clamped$map = this._clamped().map(componentHex),
              _this$_clamped$map2 = _slicedToArray(_this$_clamped$map, 3),
              r = _this$_clamped$map2[0],
              g = _this$_clamped$map2[1],
              b = _this$_clamped$map2[2];

          return "#".concat(r).concat(g).concat(b);
        }
      }, {
        key: "toString",
        value: function toString() {
          return this.toHex();
        }
      }, {
        key: "toRgb",
        value: function toRgb() {
          var _this$_clamped = this._clamped(),
              _this$_clamped2 = _slicedToArray(_this$_clamped, 3),
              rV = _this$_clamped2[0],
              gV = _this$_clamped2[1],
              bV = _this$_clamped2[2];

          var string = "rgb(".concat(rV, ",").concat(gV, ",").concat(bV, ")");
          return string;
        }
      }, {
        key: "toArray",
        value: function toArray() {
          var _a = this._a,
              _b = this._b,
              _c = this._c,
              _d = this._d,
              space = this.space;
          return [_a, _b, _c, _d, space];
        }
        /*
        Generating random colors
        */

      }], [{
        key: "random",
        value: function random() {
          var mode = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'vibrant';
          var t = arguments.length > 1 ? arguments[1] : undefined;
          // Get the math modules
          var random = Math.random,
              round = Math.round,
              sin = Math.sin,
              pi = Math.PI; // Run the correct generator

          if (mode === 'vibrant') {
            var l = (81 - 57) * random() + 57;
            var c = (83 - 45) * random() + 45;
            var h = 360 * random();
            var color = new Color(l, c, h, 'lch');
            return color;
          } else if (mode === 'sine') {
            t = t == null ? random() : t;
            var r = round(80 * sin(2 * pi * t / 0.5 + 0.01) + 150);
            var g = round(50 * sin(2 * pi * t / 0.5 + 4.6) + 200);
            var b = round(100 * sin(2 * pi * t / 0.5 + 2.3) + 150);

            var _color4 = new Color(r, g, b);

            return _color4;
          } else if (mode === 'pastel') {
            var _l2 = (94 - 86) * random() + 86;

            var _c5 = (26 - 9) * random() + 9;

            var _h2 = 360 * random();

            var _color5 = new Color(_l2, _c5, _h2, 'lch');

            return _color5;
          } else if (mode === 'dark') {
            var _l3 = 10 + 10 * random();

            var _c6 = (125 - 75) * random() + 86;

            var _h3 = 360 * random();

            var _color6 = new Color(_l3, _c6, _h3, 'lch');

            return _color6;
          } else if (mode === 'rgb') {
            var _r3 = 255 * random();

            var _g3 = 255 * random();

            var _b7 = 255 * random();

            var _color7 = new Color(_r3, _g3, _b7);

            return _color7;
          } else if (mode === 'lab') {
            var _l4 = 100 * random();

            var a = 256 * random() - 128;

            var _b8 = 256 * random() - 128;

            var _color8 = new Color(_l4, a, _b8, 'lab');

            return _color8;
          } else if (mode === 'grey') {
            var grey = 255 * random();

            var _color9 = new Color(grey, grey, grey);

            return _color9;
          }
        }
        /*
        Constructing colors
        */
        // Test if given value is a color string

      }, {
        key: "test",
        value: function test(color) {
          return typeof color === 'string' && (isHex.test(color) || isRgb.test(color));
        } // Test if given value is an rgb object

      }, {
        key: "isRgb",
        value: function isRgb(color) {
          return color && typeof color.r === 'number' && typeof color.g === 'number' && typeof color.b === 'number';
        } // Test if given value is a color

      }, {
        key: "isColor",
        value: function isColor(color) {
          return color && (color instanceof Color || this.isRgb(color) || this.test(color));
        }
      }]);

      return Color;
    }();

    var FAILS_ON_PRIMITIVES$1 = fails(function () { objectKeys(1); });

    // `Object.keys` method
    // https://tc39.github.io/ecma262/#sec-object.keys
    _export({ target: 'Object', stat: true, forced: FAILS_ON_PRIMITIVES$1 }, {
      keys: function keys(it) {
        return objectKeys(toObject(it));
      }
    });

    // @@match logic
    fixRegexpWellKnownSymbolLogic('match', 1, function (MATCH, nativeMatch, maybeCallNative) {
      return [
        // `String.prototype.match` method
        // https://tc39.github.io/ecma262/#sec-string.prototype.match
        function match(regexp) {
          var O = requireObjectCoercible(this);
          var matcher = regexp == undefined ? undefined : regexp[MATCH];
          return matcher !== undefined ? matcher.call(regexp, O) : new RegExp(regexp)[MATCH](String(O));
        },
        // `RegExp.prototype[@@match]` method
        // https://tc39.github.io/ecma262/#sec-regexp.prototype-@@match
        function (regexp) {
          var res = maybeCallNative(nativeMatch, regexp, this);
          if (res.done) return res.value;

          var rx = anObject(regexp);
          var S = String(this);

          if (!rx.global) return regexpExecAbstract(rx, S);

          var fullUnicode = rx.unicode;
          rx.lastIndex = 0;
          var A = [];
          var n = 0;
          var result;
          while ((result = regexpExecAbstract(rx, S)) !== null) {
            var matchStr = String(result[0]);
            A[n] = matchStr;
            if (matchStr === '') rx.lastIndex = advanceStringIndex(S, toLength(rx.lastIndex), fullUnicode);
            n++;
          }
          return n === 0 ? null : A;
        }
      ];
    });

    function _assertThisInitialized(self) {
      if (self === void 0) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
      }

      return self;
    }

    function _possibleConstructorReturn(self, call) {
      if (call && (_typeof(call) === "object" || typeof call === "function")) {
        return call;
      }

      return _assertThisInitialized(self);
    }

    function _getPrototypeOf(o) {
      _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) {
        return o.__proto__ || Object.getPrototypeOf(o);
      };
      return _getPrototypeOf(o);
    }

    function _superPropBase(object, property) {
      while (!Object.prototype.hasOwnProperty.call(object, property)) {
        object = _getPrototypeOf(object);
        if (object === null) break;
      }

      return object;
    }

    function _get(target, property, receiver) {
      if (typeof Reflect !== "undefined" && Reflect.get) {
        _get = Reflect.get;
      } else {
        _get = function _get(target, property, receiver) {
          var base = _superPropBase(target, property);
          if (!base) return;
          var desc = Object.getOwnPropertyDescriptor(base, property);

          if (desc.get) {
            return desc.get.call(receiver);
          }

          return desc.value;
        };
      }

      return _get(target, property, receiver || target);
    }

    function _setPrototypeOf(o, p) {
      _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) {
        o.__proto__ = p;
        return o;
      };

      return _setPrototypeOf(o, p);
    }

    function _inherits(subClass, superClass) {
      if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function");
      }

      subClass.prototype = Object.create(superClass && superClass.prototype, {
        constructor: {
          value: subClass,
          writable: true,
          configurable: true
        }
      });
      if (superClass) _setPrototypeOf(subClass, superClass);
    }

    var getOwnPropertyNames = objectGetOwnPropertyNames.f;
    var getOwnPropertyDescriptor$2 = objectGetOwnPropertyDescriptor.f;
    var defineProperty$5 = objectDefineProperty.f;
    var trim$1 = stringTrim.trim;

    var NUMBER = 'Number';
    var NativeNumber = global_1[NUMBER];
    var NumberPrototype = NativeNumber.prototype;

    // Opera ~12 has broken Object#toString
    var BROKEN_CLASSOF = classofRaw(objectCreate(NumberPrototype)) == NUMBER;

    // `ToNumber` abstract operation
    // https://tc39.github.io/ecma262/#sec-tonumber
    var toNumber = function (argument) {
      var it = toPrimitive(argument, false);
      var first, third, radix, maxCode, digits, length, index, code;
      if (typeof it == 'string' && it.length > 2) {
        it = trim$1(it);
        first = it.charCodeAt(0);
        if (first === 43 || first === 45) {
          third = it.charCodeAt(2);
          if (third === 88 || third === 120) return NaN; // Number('+0x1') should be NaN, old V8 fix
        } else if (first === 48) {
          switch (it.charCodeAt(1)) {
            case 66: case 98: radix = 2; maxCode = 49; break; // fast equal of /^0b[01]+$/i
            case 79: case 111: radix = 8; maxCode = 55; break; // fast equal of /^0o[0-7]+$/i
            default: return +it;
          }
          digits = it.slice(2);
          length = digits.length;
          for (index = 0; index < length; index++) {
            code = digits.charCodeAt(index);
            // parseInt parses a string to a first unavailable symbol
            // but ToNumber should return NaN if a string contains unavailable symbols
            if (code < 48 || code > maxCode) return NaN;
          } return parseInt(digits, radix);
        }
      } return +it;
    };

    // `Number` constructor
    // https://tc39.github.io/ecma262/#sec-number-constructor
    if (isForced_1(NUMBER, !NativeNumber(' 0o1') || !NativeNumber('0b1') || NativeNumber('+0x1'))) {
      var NumberWrapper = function Number(value) {
        var it = arguments.length < 1 ? 0 : value;
        var dummy = this;
        return dummy instanceof NumberWrapper
          // check on 1..constructor(foo) case
          && (BROKEN_CLASSOF ? fails(function () { NumberPrototype.valueOf.call(dummy); }) : classofRaw(dummy) != NUMBER)
            ? inheritIfRequired(new NativeNumber(toNumber(it)), dummy, NumberWrapper) : toNumber(it);
      };
      for (var keys$1 = descriptors ? getOwnPropertyNames(NativeNumber) : (
        // ES3:
        'MAX_VALUE,MIN_VALUE,NaN,NEGATIVE_INFINITY,POSITIVE_INFINITY,' +
        // ES2015 (in case, if modules with ES2015 Number statics required before):
        'EPSILON,isFinite,isInteger,isNaN,isSafeInteger,MAX_SAFE_INTEGER,' +
        'MIN_SAFE_INTEGER,parseFloat,parseInt,isInteger'
      ).split(','), j = 0, key; keys$1.length > j; j++) {
        if (has(NativeNumber, key = keys$1[j]) && !has(NumberWrapper, key)) {
          defineProperty$5(NumberWrapper, key, getOwnPropertyDescriptor$2(NativeNumber, key));
        }
      }
      NumberWrapper.prototype = NumberPrototype;
      NumberPrototype.constructor = NumberWrapper;
      redefine(global_1, NUMBER, NumberWrapper);
    }

    var trim$2 = stringTrim.trim;


    var nativeParseFloat = global_1.parseFloat;
    var FORCED$2 = 1 / nativeParseFloat(whitespaces + '-0') !== -Infinity;

    // `parseFloat` method
    // https://tc39.github.io/ecma262/#sec-parsefloat-string
    var _parseFloat = FORCED$2 ? function parseFloat(string) {
      var trimmedString = trim$2(String(string));
      var result = nativeParseFloat(trimmedString);
      return result === 0 && trimmedString.charAt(0) == '-' ? -0 : result;
    } : nativeParseFloat;

    // `parseFloat` method
    // https://tc39.github.io/ecma262/#sec-parsefloat-string
    _export({ global: true, forced: parseFloat != _parseFloat }, {
      parseFloat: _parseFloat
    });

    var Point =
    /*#__PURE__*/
    function () {
      // Initialize
      function Point() {
        _classCallCheck(this, Point);

        this.init.apply(this, arguments);
      }

      _createClass(Point, [{
        key: "init",
        value: function init(x, y) {
          var base = {
            x: 0,
            y: 0
          }; // ensure source as object

          var source = Array.isArray(x) ? {
            x: x[0],
            y: x[1]
          } : _typeof(x) === 'object' ? {
            x: x.x,
            y: x.y
          } : {
            x: x,
            y: y
          }; // merge source

          this.x = source.x == null ? base.x : source.x;
          this.y = source.y == null ? base.y : source.y;
          return this;
        } // Clone point

      }, {
        key: "clone",
        value: function clone() {
          return new Point(this);
        }
      }, {
        key: "transform",
        value: function transform(m) {
          return this.clone().transformO(m);
        } // Transform point with matrix

      }, {
        key: "transformO",
        value: function transformO(m) {
          if (!Matrix.isMatrixLike(m)) {
            m = new Matrix(m);
          }

          var x = this.x,
              y = this.y; // Perform the matrix multiplication

          this.x = m.a * x + m.c * y + m.e;
          this.y = m.b * x + m.d * y + m.f;
          return this;
        }
      }, {
        key: "toArray",
        value: function toArray() {
          return [this.x, this.y];
        }
      }]);

      return Point;
    }();
    function point(x, y) {
      return new Point(x, y).transform(this.screenCTM().inverse());
    }

    function closeEnough(a, b, threshold) {
      return Math.abs(b - a) < (threshold || 1e-6);
    }

    var Matrix =
    /*#__PURE__*/
    function () {
      function Matrix() {
        _classCallCheck(this, Matrix);

        this.init.apply(this, arguments);
      } // Initialize


      _createClass(Matrix, [{
        key: "init",
        value: function init(source) {
          var base = Matrix.fromArray([1, 0, 0, 1, 0, 0]); // ensure source as object

          source = source instanceof Element ? source.matrixify() : typeof source === 'string' ? Matrix.fromArray(source.split(delimiter).map(parseFloat)) : Array.isArray(source) ? Matrix.fromArray(source) : _typeof(source) === 'object' && Matrix.isMatrixLike(source) ? source : _typeof(source) === 'object' ? new Matrix().transform(source) : arguments.length === 6 ? Matrix.fromArray([].slice.call(arguments)) : base; // Merge the source matrix with the base matrix

          this.a = source.a != null ? source.a : base.a;
          this.b = source.b != null ? source.b : base.b;
          this.c = source.c != null ? source.c : base.c;
          this.d = source.d != null ? source.d : base.d;
          this.e = source.e != null ? source.e : base.e;
          this.f = source.f != null ? source.f : base.f;
          return this;
        } // Clones this matrix

      }, {
        key: "clone",
        value: function clone() {
          return new Matrix(this);
        } // Transform a matrix into another matrix by manipulating the space

      }, {
        key: "transform",
        value: function transform(o) {
          // Check if o is a matrix and then left multiply it directly
          if (Matrix.isMatrixLike(o)) {
            var matrix = new Matrix(o);
            return matrix.multiplyO(this);
          } // Get the proposed transformations and the current transformations


          var t = Matrix.formatTransforms(o);
          var current = this;

          var _transform = new Point(t.ox, t.oy).transform(current),
              ox = _transform.x,
              oy = _transform.y; // Construct the resulting matrix


          var transformer = new Matrix().translateO(t.rx, t.ry).lmultiplyO(current).translateO(-ox, -oy).scaleO(t.scaleX, t.scaleY).skewO(t.skewX, t.skewY).shearO(t.shear).rotateO(t.theta).translateO(ox, oy); // If we want the origin at a particular place, we force it there

          if (isFinite(t.px) || isFinite(t.py)) {
            var origin = new Point(ox, oy).transform(transformer); // TODO: Replace t.px with isFinite(t.px)

            var dx = t.px ? t.px - origin.x : 0;
            var dy = t.py ? t.py - origin.y : 0;
            transformer.translateO(dx, dy);
          } // Translate now after positioning


          transformer.translateO(t.tx, t.ty);
          return transformer;
        } // Applies a matrix defined by its affine parameters

      }, {
        key: "compose",
        value: function compose(o) {
          if (o.origin) {
            o.originX = o.origin[0];
            o.originY = o.origin[1];
          } // Get the parameters


          var ox = o.originX || 0;
          var oy = o.originY || 0;
          var sx = o.scaleX || 1;
          var sy = o.scaleY || 1;
          var lam = o.shear || 0;
          var theta = o.rotate || 0;
          var tx = o.translateX || 0;
          var ty = o.translateY || 0; // Apply the standard matrix

          var result = new Matrix().translateO(-ox, -oy).scaleO(sx, sy).shearO(lam).rotateO(theta).translateO(tx, ty).lmultiplyO(this).translateO(ox, oy);
          return result;
        } // Decomposes this matrix into its affine parameters

      }, {
        key: "decompose",
        value: function decompose() {
          var cx = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
          var cy = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
          // Get the parameters from the matrix
          var a = this.a;
          var b = this.b;
          var c = this.c;
          var d = this.d;
          var e = this.e;
          var f = this.f; // Figure out if the winding direction is clockwise or counterclockwise

          var determinant = a * d - b * c;
          var ccw = determinant > 0 ? 1 : -1; // Since we only shear in x, we can use the x basis to get the x scale
          // and the rotation of the resulting matrix

          var sx = ccw * Math.sqrt(a * a + b * b);
          var thetaRad = Math.atan2(ccw * b, ccw * a);
          var theta = 180 / Math.PI * thetaRad;
          var ct = Math.cos(thetaRad);
          var st = Math.sin(thetaRad); // We can then solve the y basis vector simultaneously to get the other
          // two affine parameters directly from these parameters

          var lam = (a * c + b * d) / determinant;
          var sy = c * sx / (lam * a - b) || d * sx / (lam * b + a); // Use the translations

          var tx = e - cx + cx * ct * sx + cy * (lam * ct * sx - st * sy);
          var ty = f - cy + cx * st * sx + cy * (lam * st * sx + ct * sy); // Construct the decomposition and return it

          return {
            // Return the affine parameters
            scaleX: sx,
            scaleY: sy,
            shear: lam,
            rotate: theta,
            translateX: tx,
            translateY: ty,
            originX: cx,
            originY: cy,
            // Return the matrix parameters
            a: this.a,
            b: this.b,
            c: this.c,
            d: this.d,
            e: this.e,
            f: this.f
          };
        } // Left multiplies by the given matrix

      }, {
        key: "multiply",
        value: function multiply(matrix) {
          return this.clone().multiplyO(matrix);
        }
      }, {
        key: "multiplyO",
        value: function multiplyO(matrix) {
          // Get the matrices
          var l = this;
          var r = matrix instanceof Matrix ? matrix : new Matrix(matrix);
          return Matrix.matrixMultiply(l, r, this);
        }
      }, {
        key: "lmultiply",
        value: function lmultiply(matrix) {
          return this.clone().lmultiplyO(matrix);
        }
      }, {
        key: "lmultiplyO",
        value: function lmultiplyO(matrix) {
          var r = this;
          var l = matrix instanceof Matrix ? matrix : new Matrix(matrix);
          return Matrix.matrixMultiply(l, r, this);
        } // Inverses matrix

      }, {
        key: "inverseO",
        value: function inverseO() {
          // Get the current parameters out of the matrix
          var a = this.a;
          var b = this.b;
          var c = this.c;
          var d = this.d;
          var e = this.e;
          var f = this.f; // Invert the 2x2 matrix in the top left

          var det = a * d - b * c;
          if (!det) throw new Error('Cannot invert ' + this); // Calculate the top 2x2 matrix

          var na = d / det;
          var nb = -b / det;
          var nc = -c / det;
          var nd = a / det; // Apply the inverted matrix to the top right

          var ne = -(na * e + nc * f);
          var nf = -(nb * e + nd * f); // Construct the inverted matrix

          this.a = na;
          this.b = nb;
          this.c = nc;
          this.d = nd;
          this.e = ne;
          this.f = nf;
          return this;
        }
      }, {
        key: "inverse",
        value: function inverse() {
          return this.clone().inverseO();
        } // Translate matrix

      }, {
        key: "translate",
        value: function translate(x, y) {
          return this.clone().translateO(x, y);
        }
      }, {
        key: "translateO",
        value: function translateO(x, y) {
          this.e += x || 0;
          this.f += y || 0;
          return this;
        } // Scale matrix

      }, {
        key: "scale",
        value: function scale(x, y, cx, cy) {
          var _this$clone;

          return (_this$clone = this.clone()).scaleO.apply(_this$clone, arguments);
        }
      }, {
        key: "scaleO",
        value: function scaleO(x) {
          var y = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : x;
          var cx = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
          var cy = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 0;

          // Support uniform scaling
          if (arguments.length === 3) {
            cy = cx;
            cx = y;
            y = x;
          }

          var a = this.a,
              b = this.b,
              c = this.c,
              d = this.d,
              e = this.e,
              f = this.f;
          this.a = a * x;
          this.b = b * y;
          this.c = c * x;
          this.d = d * y;
          this.e = e * x - cx * x + cx;
          this.f = f * y - cy * y + cy;
          return this;
        } // Rotate matrix

      }, {
        key: "rotate",
        value: function rotate(r, cx, cy) {
          return this.clone().rotateO(r, cx, cy);
        }
      }, {
        key: "rotateO",
        value: function rotateO(r) {
          var cx = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
          var cy = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
          // Convert degrees to radians
          r = radians(r);
          var cos = Math.cos(r);
          var sin = Math.sin(r);
          var a = this.a,
              b = this.b,
              c = this.c,
              d = this.d,
              e = this.e,
              f = this.f;
          this.a = a * cos - b * sin;
          this.b = b * cos + a * sin;
          this.c = c * cos - d * sin;
          this.d = d * cos + c * sin;
          this.e = e * cos - f * sin + cy * sin - cx * cos + cx;
          this.f = f * cos + e * sin - cx * sin - cy * cos + cy;
          return this;
        } // Flip matrix on x or y, at a given offset

      }, {
        key: "flip",
        value: function flip(axis, around) {
          return this.clone().flipO(axis, around);
        }
      }, {
        key: "flipO",
        value: function flipO(axis, around) {
          return axis === 'x' ? this.scaleO(-1, 1, around, 0) : axis === 'y' ? this.scaleO(1, -1, 0, around) : this.scaleO(-1, -1, axis, around || axis); // Define an x, y flip point
        } // Shear matrix

      }, {
        key: "shear",
        value: function shear(a, cx, cy) {
          return this.clone().shearO(a, cx, cy);
        }
      }, {
        key: "shearO",
        value: function shearO(lx) {
          var cy = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
          var a = this.a,
              b = this.b,
              c = this.c,
              d = this.d,
              e = this.e,
              f = this.f;
          this.a = a + b * lx;
          this.c = c + d * lx;
          this.e = e + f * lx - cy * lx;
          return this;
        } // Skew Matrix

      }, {
        key: "skew",
        value: function skew(x, y, cx, cy) {
          var _this$clone2;

          return (_this$clone2 = this.clone()).skewO.apply(_this$clone2, arguments);
        }
      }, {
        key: "skewO",
        value: function skewO(x) {
          var y = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : x;
          var cx = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
          var cy = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 0;

          // support uniformal skew
          if (arguments.length === 3) {
            cy = cx;
            cx = y;
            y = x;
          } // Convert degrees to radians


          x = radians(x);
          y = radians(y);
          var lx = Math.tan(x);
          var ly = Math.tan(y);
          var a = this.a,
              b = this.b,
              c = this.c,
              d = this.d,
              e = this.e,
              f = this.f;
          this.a = a + b * lx;
          this.b = b + a * ly;
          this.c = c + d * lx;
          this.d = d + c * ly;
          this.e = e + f * lx - cy * lx;
          this.f = f + e * ly - cx * ly;
          return this;
        } // SkewX

      }, {
        key: "skewX",
        value: function skewX(x, cx, cy) {
          return this.skew(x, 0, cx, cy);
        }
      }, {
        key: "skewXO",
        value: function skewXO(x, cx, cy) {
          return this.skewO(x, 0, cx, cy);
        } // SkewY

      }, {
        key: "skewY",
        value: function skewY(y, cx, cy) {
          return this.skew(0, y, cx, cy);
        }
      }, {
        key: "skewYO",
        value: function skewYO(y, cx, cy) {
          return this.skewO(0, y, cx, cy);
        } // Transform around a center point

      }, {
        key: "aroundO",
        value: function aroundO(cx, cy, matrix) {
          var dx = cx || 0;
          var dy = cy || 0;
          return this.translateO(-dx, -dy).lmultiplyO(matrix).translateO(dx, dy);
        }
      }, {
        key: "around",
        value: function around(cx, cy, matrix) {
          return this.clone().aroundO(cx, cy, matrix);
        } // Check if two matrices are equal

      }, {
        key: "equals",
        value: function equals(other) {
          var comp = new Matrix(other);
          return closeEnough(this.a, comp.a) && closeEnough(this.b, comp.b) && closeEnough(this.c, comp.c) && closeEnough(this.d, comp.d) && closeEnough(this.e, comp.e) && closeEnough(this.f, comp.f);
        } // Convert matrix to string

      }, {
        key: "toString",
        value: function toString() {
          return 'matrix(' + this.a + ',' + this.b + ',' + this.c + ',' + this.d + ',' + this.e + ',' + this.f + ')';
        }
      }, {
        key: "toArray",
        value: function toArray() {
          return [this.a, this.b, this.c, this.d, this.e, this.f];
        }
      }, {
        key: "valueOf",
        value: function valueOf() {
          return {
            a: this.a,
            b: this.b,
            c: this.c,
            d: this.d,
            e: this.e,
            f: this.f
          };
        }
      }], [{
        key: "fromArray",
        value: function fromArray(a) {
          return {
            a: a[0],
            b: a[1],
            c: a[2],
            d: a[3],
            e: a[4],
            f: a[5]
          };
        }
      }, {
        key: "isMatrixLike",
        value: function isMatrixLike(o) {
          return o.a != null || o.b != null || o.c != null || o.d != null || o.e != null || o.f != null;
        }
      }, {
        key: "formatTransforms",
        value: function formatTransforms(o) {
          // Get all of the parameters required to form the matrix
          var flipBoth = o.flip === 'both' || o.flip === true;
          var flipX = o.flip && (flipBoth || o.flip === 'x') ? -1 : 1;
          var flipY = o.flip && (flipBoth || o.flip === 'y') ? -1 : 1;
          var skewX = o.skew && o.skew.length ? o.skew[0] : isFinite(o.skew) ? o.skew : isFinite(o.skewX) ? o.skewX : 0;
          var skewY = o.skew && o.skew.length ? o.skew[1] : isFinite(o.skew) ? o.skew : isFinite(o.skewY) ? o.skewY : 0;
          var scaleX = o.scale && o.scale.length ? o.scale[0] * flipX : isFinite(o.scale) ? o.scale * flipX : isFinite(o.scaleX) ? o.scaleX * flipX : flipX;
          var scaleY = o.scale && o.scale.length ? o.scale[1] * flipY : isFinite(o.scale) ? o.scale * flipY : isFinite(o.scaleY) ? o.scaleY * flipY : flipY;
          var shear = o.shear || 0;
          var theta = o.rotate || o.theta || 0;
          var origin = new Point(o.origin || o.around || o.ox || o.originX, o.oy || o.originY);
          var ox = origin.x;
          var oy = origin.y;
          var position = new Point(o.position || o.px || o.positionX, o.py || o.positionY);
          var px = position.x;
          var py = position.y;
          var translate = new Point(o.translate || o.tx || o.translateX, o.ty || o.translateY);
          var tx = translate.x;
          var ty = translate.y;
          var relative = new Point(o.relative || o.rx || o.relativeX, o.ry || o.relativeY);
          var rx = relative.x;
          var ry = relative.y; // Populate all of the values

          return {
            scaleX: scaleX,
            scaleY: scaleY,
            skewX: skewX,
            skewY: skewY,
            shear: shear,
            theta: theta,
            rx: rx,
            ry: ry,
            tx: tx,
            ty: ty,
            ox: ox,
            oy: oy,
            px: px,
            py: py
          };
        } // left matrix, right matrix, target matrix which is overwritten

      }, {
        key: "matrixMultiply",
        value: function matrixMultiply(l, r, o) {
          // Work out the product directly
          var a = l.a * r.a + l.c * r.b;
          var b = l.b * r.a + l.d * r.b;
          var c = l.a * r.c + l.c * r.d;
          var d = l.b * r.c + l.d * r.d;
          var e = l.e + l.a * r.e + l.c * r.f;
          var f = l.f + l.b * r.e + l.d * r.f; // make sure to use local variables because l/r and o could be the same

          o.a = a;
          o.b = b;
          o.c = c;
          o.d = d;
          o.e = e;
          o.f = f;
          return o;
        }
      }]);

      return Matrix;
    }();
    function ctm() {
      return new Matrix(this.node.getCTM());
    }
    function screenCTM() {
      /* https://bugzilla.mozilla.org/show_bug.cgi?id=1344537
         This is needed because FF does not return the transformation matrix
         for the inner coordinate system when getScreenCTM() is called on nested svgs.
         However all other Browsers do that */
      if (typeof this.isRoot === 'function' && !this.isRoot()) {
        var rect = this.rect(1, 1);
        var m = rect.node.getScreenCTM();
        rect.remove();
        return new Matrix(m);
      }

      return new Matrix(this.node.getScreenCTM());
    }
    register(Matrix, 'Matrix');

    function parser() {
      // Reuse cached element if possible
      if (!parser.nodes) {
        var svg = makeInstance().size(2, 0);
        svg.node.style.cssText = ['opacity: 0', 'position: absolute', 'left: -100%', 'top: -100%', 'overflow: hidden'].join(';');
        svg.attr('focusable', 'false');
        svg.attr('aria-hidden', 'true');
        var path = svg.path().node;
        parser.nodes = {
          svg: svg,
          path: path
        };
      }

      if (!parser.nodes.svg.node.parentNode) {
        var b = globals$1.document.body || globals$1.document.documentElement;
        parser.nodes.svg.addTo(b);
      }

      return parser.nodes;
    }

    function isNulledBox(box) {
      return !box.width && !box.height && !box.x && !box.y;
    }

    function domContains(node) {
      return node === globals$1.document || (globals$1.document.documentElement.contains || function (node) {
        // This is IE - it does not support contains() for top-level SVGs
        while (node.parentNode) {
          node = node.parentNode;
        }

        return node === globals$1.document;
      }).call(globals$1.document.documentElement, node);
    }

    var Box =
    /*#__PURE__*/
    function () {
      function Box() {
        _classCallCheck(this, Box);

        this.init.apply(this, arguments);
      }

      _createClass(Box, [{
        key: "init",
        value: function init(source) {
          var base = [0, 0, 0, 0];
          source = typeof source === 'string' ? source.split(delimiter).map(parseFloat) : Array.isArray(source) ? source : _typeof(source) === 'object' ? [source.left != null ? source.left : source.x, source.top != null ? source.top : source.y, source.width, source.height] : arguments.length === 4 ? [].slice.call(arguments) : base;
          this.x = source[0] || 0;
          this.y = source[1] || 0;
          this.width = this.w = source[2] || 0;
          this.height = this.h = source[3] || 0; // Add more bounding box properties

          this.x2 = this.x + this.w;
          this.y2 = this.y + this.h;
          this.cx = this.x + this.w / 2;
          this.cy = this.y + this.h / 2;
          return this;
        } // Merge rect box with another, return a new instance

      }, {
        key: "merge",
        value: function merge(box) {
          var x = Math.min(this.x, box.x);
          var y = Math.min(this.y, box.y);
          var width = Math.max(this.x + this.width, box.x + box.width) - x;
          var height = Math.max(this.y + this.height, box.y + box.height) - y;
          return new Box(x, y, width, height);
        }
      }, {
        key: "transform",
        value: function transform(m) {
          if (!(m instanceof Matrix)) {
            m = new Matrix(m);
          }

          var xMin = Infinity;
          var xMax = -Infinity;
          var yMin = Infinity;
          var yMax = -Infinity;
          var pts = [new Point(this.x, this.y), new Point(this.x2, this.y), new Point(this.x, this.y2), new Point(this.x2, this.y2)];
          pts.forEach(function (p) {
            p = p.transform(m);
            xMin = Math.min(xMin, p.x);
            xMax = Math.max(xMax, p.x);
            yMin = Math.min(yMin, p.y);
            yMax = Math.max(yMax, p.y);
          });
          return new Box(xMin, yMin, xMax - xMin, yMax - yMin);
        }
      }, {
        key: "addOffset",
        value: function addOffset() {
          // offset by window scroll position, because getBoundingClientRect changes when window is scrolled
          this.x += globals$1.window.pageXOffset;
          this.y += globals$1.window.pageYOffset;
          return this;
        }
      }, {
        key: "toString",
        value: function toString() {
          return this.x + ' ' + this.y + ' ' + this.width + ' ' + this.height;
        }
      }, {
        key: "toArray",
        value: function toArray() {
          return [this.x, this.y, this.width, this.height];
        }
      }, {
        key: "isNulled",
        value: function isNulled() {
          return isNulledBox(this);
        }
      }]);

      return Box;
    }();

    function getBox(cb, retry) {
      var box;

      try {
        box = cb(this.node);

        if (isNulledBox(box) && !domContains(this.node)) {
          throw new Error('Element not in the dom');
        }
      } catch (e) {
        box = retry(this);
      }

      return box;
    }

    function bbox() {
      return new Box(getBox.call(this, function (node) {
        return node.getBBox();
      }, function (el) {
        try {
          var clone = el.clone().addTo(parser().svg).show();
          var box = clone.node.getBBox();
          clone.remove();
          return box;
        } catch (e) {
          throw new Error('Getting bbox of element "' + el.node.nodeName + '" is not possible. ' + e.toString());
        }
      }));
    }
    function rbox(el) {
      var box = new Box(getBox.call(this, function (node) {
        return node.getBoundingClientRect();
      }, function (el) {
        throw new Error('Getting rbox of element "' + el.node.nodeName + '" is not possible');
      }));
      if (el) return box.transform(el.screenCTM().inverse());
      return box.addOffset();
    }
    registerMethods({
      viewbox: {
        viewbox: function viewbox(x, y, width, height) {
          // act as getter
          if (x == null) return new Box(this.attr('viewBox')); // act as setter

          return this.attr('viewBox', new Box(x, y, width, height));
        },
        zoom: function zoom(level, point) {
          var width = this.node.clientWidth;
          var height = this.node.clientHeight;
          var v = this.viewbox(); // Firefox does not support clientHeight and returns 0
          // https://bugzilla.mozilla.org/show_bug.cgi?id=874811

          if (!width && !height) {
            var style = window.getComputedStyle(this.node);
            width = parseFloat(style.getPropertyValue('width'));
            height = parseFloat(style.getPropertyValue('height'));
          }

          var zoomX = width / v.width;
          var zoomY = height / v.height;
          var zoom = Math.min(zoomX, zoomY);

          if (level == null) {
            return zoom;
          }

          var zoomAmount = zoom / level;
          if (zoomAmount === Infinity) zoomAmount = Number.MIN_VALUE;
          point = point || new Point(width / 2 / zoomX + v.x, height / 2 / zoomY + v.y);
          var box = new Box(v).transform(new Matrix({
            scale: zoomAmount,
            origin: point
          }));
          return this.viewbox(box);
        }
      }
    });
    register(Box, 'Box');

    /* eslint no-new-func: "off" */
    var subClassArray = function () {
      try {
        // try es6 subclassing
        return Function('name', 'baseClass', '_constructor', ['baseClass = baseClass || Array', 'return {', '  [name]: class extends baseClass {', '    constructor (...args) {', '      super(...args)', '      _constructor && _constructor.apply(this, args)', '    }', '  }', '}[name]'].join('\n'));
      } catch (e) {
        // Use es5 approach
        return function (name) {
          var baseClass = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : Array;

          var _constructor = arguments.length > 2 ? arguments[2] : undefined;

          var Arr = function Arr() {
            baseClass.apply(this, arguments);
            _constructor && _constructor.apply(this, arguments);
          };

          Arr.prototype = Object.create(baseClass.prototype);
          Arr.prototype.constructor = Arr;

          Arr.prototype.map = function (fn) {
            var arr = new Arr();
            arr.push.apply(arr, Array.prototype.map.call(this, fn));
            return arr;
          };

          return Arr;
        };
      }
    }();

    var List = subClassArray('List', Array, function () {
      var arr = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
      // This catches the case, that native map tries to create an array with new Array(1)
      if (typeof arr === 'number') return this;
      this.length = 0;
      this.push.apply(this, _toConsumableArray(arr));
    });
    extend(List, {
      each: function each(fnOrMethodName) {
        for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
          args[_key - 1] = arguments[_key];
        }

        if (typeof fnOrMethodName === 'function') {
          return this.map(function (el) {
            return fnOrMethodName.call(el, el);
          });
        } else {
          return this.map(function (el) {
            return el[fnOrMethodName].apply(el, args);
          });
        }
      },
      toArray: function toArray() {
        return Array.prototype.concat.apply([], this);
      }
    });
    var reserved = ['toArray', 'constructor', 'each'];

    List.extend = function (methods) {
      methods = methods.reduce(function (obj, name) {
        // Don't overwrite own methods
        if (reserved.includes(name)) return obj; // Don't add private methods

        if (name[0] === '_') return obj; // Relay every call to each()

        obj[name] = function () {
          for (var _len2 = arguments.length, attrs = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
            attrs[_key2] = arguments[_key2];
          }

          return this.each.apply(this, [name].concat(attrs));
        };

        return obj;
      }, {});
      extend(List, methods);
    };

    function baseFind(query, parent) {
      return new List(map((parent || globals$1.document).querySelectorAll(query), function (node) {
        return adopt(node);
      }));
    } // Scoped find method

    function find(query) {
      return baseFind(query, this.node);
    }
    function findOne(query) {
      return adopt(this.node.querySelector(query));
    }

    var EventTarget =
    /*#__PURE__*/
    function (_Base) {
      _inherits(EventTarget, _Base);

      function EventTarget() {
        var _this;

        var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
            _ref$events = _ref.events,
            events = _ref$events === void 0 ? {} : _ref$events;

        _classCallCheck(this, EventTarget);

        _this = _possibleConstructorReturn(this, _getPrototypeOf(EventTarget).call(this));
        _this.events = events;
        return _this;
      }

      _createClass(EventTarget, [{
        key: "addEventListener",
        value: function addEventListener() {}
      }, {
        key: "dispatch",
        value: function dispatch$1(event, data) {
          return dispatch(this, event, data);
        }
      }, {
        key: "dispatchEvent",
        value: function dispatchEvent(event) {
          var bag = this.getEventHolder().events;
          if (!bag) return true;
          var events = bag[event.type];

          for (var i in events) {
            for (var j in events[i]) {
              events[i][j](event);
            }
          }

          return !event.defaultPrevented;
        } // Fire given event

      }, {
        key: "fire",
        value: function fire(event, data) {
          this.dispatch(event, data);
          return this;
        }
      }, {
        key: "getEventHolder",
        value: function getEventHolder() {
          return this;
        }
      }, {
        key: "getEventTarget",
        value: function getEventTarget() {
          return this;
        } // Unbind event from listener

      }, {
        key: "off",
        value: function off$1(event, listener) {
          off(this, event, listener);

          return this;
        } // Bind given event to listener

      }, {
        key: "on",
        value: function on$1(event, listener, binding, options) {
          on(this, event, listener, binding, options);

          return this;
        }
      }, {
        key: "removeEventListener",
        value: function removeEventListener() {}
      }]);

      return EventTarget;
    }(Base);
    register(EventTarget, 'EventTarget');

    function noop$1() {} // Default animation values

    var timeline = {
      duration: 400,
      ease: '>',
      delay: 0
    }; // Default attribute values

    var attrs = {
      // fill and stroke
      'fill-opacity': 1,
      'stroke-opacity': 1,
      'stroke-width': 0,
      'stroke-linejoin': 'miter',
      'stroke-linecap': 'butt',
      fill: '#000000',
      stroke: '#000000',
      opacity: 1,
      // position
      x: 0,
      y: 0,
      cx: 0,
      cy: 0,
      // size
      width: 0,
      height: 0,
      // radius
      r: 0,
      rx: 0,
      ry: 0,
      // gradient
      offset: 0,
      'stop-opacity': 1,
      'stop-color': '#000000',
      // text
      'text-anchor': 'start'
    };

    var SVGArray = subClassArray('SVGArray', Array, function (arr) {
      this.init(arr);
    });
    extend(SVGArray, {
      init: function init(arr) {
        // This catches the case, that native map tries to create an array with new Array(1)
        if (typeof arr === 'number') return this;
        this.length = 0;
        this.push.apply(this, _toConsumableArray(this.parse(arr)));
        return this;
      },
      toArray: function toArray() {
        return Array.prototype.concat.apply([], this);
      },
      toString: function toString() {
        return this.join(' ');
      },
      // Flattens the array if needed
      valueOf: function valueOf() {
        var ret = [];
        ret.push.apply(ret, _toConsumableArray(this));
        return ret;
      },
      // Parse whitespace separated string
      parse: function parse() {
        var array = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
        // If already is an array, no need to parse it
        if (array instanceof Array) return array;
        return array.trim().split(delimiter).map(parseFloat);
      },
      clone: function clone() {
        return new this.constructor(this);
      },
      toSet: function toSet() {
        return new Set(this);
      }
    });

    var SVGNumber =
    /*#__PURE__*/
    function () {
      // Initialize
      function SVGNumber() {
        _classCallCheck(this, SVGNumber);

        this.init.apply(this, arguments);
      }

      _createClass(SVGNumber, [{
        key: "init",
        value: function init(value, unit) {
          unit = Array.isArray(value) ? value[1] : unit;
          value = Array.isArray(value) ? value[0] : value; // initialize defaults

          this.value = 0;
          this.unit = unit || ''; // parse value

          if (typeof value === 'number') {
            // ensure a valid numeric value
            this.value = isNaN(value) ? 0 : !isFinite(value) ? value < 0 ? -3.4e+38 : +3.4e+38 : value;
          } else if (typeof value === 'string') {
            unit = value.match(numberAndUnit);

            if (unit) {
              // make value numeric
              this.value = parseFloat(unit[1]); // normalize

              if (unit[5] === '%') {
                this.value /= 100;
              } else if (unit[5] === 's') {
                this.value *= 1000;
              } // store unit


              this.unit = unit[5];
            }
          } else {
            if (value instanceof SVGNumber) {
              this.value = value.valueOf();
              this.unit = value.unit;
            }
          }

          return this;
        }
      }, {
        key: "toString",
        value: function toString() {
          return (this.unit === '%' ? ~~(this.value * 1e8) / 1e6 : this.unit === 's' ? this.value / 1e3 : this.value) + this.unit;
        }
      }, {
        key: "toJSON",
        value: function toJSON() {
          return this.toString();
        }
      }, {
        key: "toArray",
        value: function toArray() {
          return [this.value, this.unit];
        }
      }, {
        key: "valueOf",
        value: function valueOf() {
          return this.value;
        } // Add number

      }, {
        key: "plus",
        value: function plus(number) {
          number = new SVGNumber(number);
          return new SVGNumber(this + number, this.unit || number.unit);
        } // Subtract number

      }, {
        key: "minus",
        value: function minus(number) {
          number = new SVGNumber(number);
          return new SVGNumber(this - number, this.unit || number.unit);
        } // Multiply number

      }, {
        key: "times",
        value: function times(number) {
          number = new SVGNumber(number);
          return new SVGNumber(this * number, this.unit || number.unit);
        } // Divide number

      }, {
        key: "divide",
        value: function divide(number) {
          number = new SVGNumber(number);
          return new SVGNumber(this / number, this.unit || number.unit);
        }
      }, {
        key: "convert",
        value: function convert(unit) {
          return new SVGNumber(this.value, unit);
        }
      }]);

      return SVGNumber;
    }();

    var hooks = [];
    function registerAttrHook(fn) {
      hooks.push(fn);
    } // Set svg element attribute

    function attr$1(attr, val, ns) {
      var _this = this;

      // act as full getter
      if (attr == null) {
        // get an object of attributes
        attr = {};
        val = this.node.attributes;
        var _iteratorNormalCompletion = true;
        var _didIteratorError = false;
        var _iteratorError = undefined;

        try {
          for (var _iterator = val[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
            var node = _step.value;
            attr[node.nodeName] = isNumber.test(node.nodeValue) ? parseFloat(node.nodeValue) : node.nodeValue;
          }
        } catch (err) {
          _didIteratorError = true;
          _iteratorError = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion && _iterator.return != null) {
              _iterator.return();
            }
          } finally {
            if (_didIteratorError) {
              throw _iteratorError;
            }
          }
        }

        return attr;
      } else if (attr instanceof Array) {
        // loop through array and get all values
        return attr.reduce(function (last, curr) {
          last[curr] = _this.attr(curr);
          return last;
        }, {});
      } else if (_typeof(attr) === 'object' && attr.constructor === Object) {
        // apply every attribute individually if an object is passed
        for (val in attr) {
          this.attr(val, attr[val]);
        }
      } else if (val === null) {
        // remove value
        this.node.removeAttribute(attr);
      } else if (val == null) {
        // act as a getter if the first and only argument is not an object
        val = this.node.getAttribute(attr);
        return val == null ? attrs[attr] : isNumber.test(val) ? parseFloat(val) : val;
      } else {
        // Loop through hooks and execute them to convert value
        val = hooks.reduce(function (_val, hook) {
          return hook(attr, _val, _this);
        }, val); // ensure correct numeric values (also accepts NaN and Infinity)

        if (typeof val === 'number') {
          val = new SVGNumber(val);
        } else if (Color.isColor(val)) {
          // ensure full hex color
          val = new Color(val);
        } else if (val.constructor === Array) {
          // Check for plain arrays and parse array values
          val = new SVGArray(val);
        } // if the passed attribute is leading...


        if (attr === 'leading') {
          // ... call the leading method instead
          if (this.leading) {
            this.leading(val);
          }
        } else {
          // set given attribute on node
          typeof ns === 'string' ? this.node.setAttributeNS(ns, attr, val.toString()) : this.node.setAttribute(attr, val.toString());
        } // rebuild if required


        if (this.rebuild && (attr === 'font-size' || attr === 'x')) {
          this.rebuild();
        }
      }

      return this;
    }

    var Dom =
    /*#__PURE__*/
    function (_EventTarget) {
      _inherits(Dom, _EventTarget);

      function Dom(node, attrs) {
        var _this2;

        _classCallCheck(this, Dom);

        _this2 = _possibleConstructorReturn(this, _getPrototypeOf(Dom).call(this, node));
        _this2.node = node;
        _this2.type = node.nodeName;

        if (attrs && node !== attrs) {
          _this2.attr(attrs);
        }

        return _this2;
      } // Add given element at a position


      _createClass(Dom, [{
        key: "add",
        value: function add(element, i) {
          element = makeInstance(element);

          if (i == null) {
            this.node.appendChild(element.node);
          } else if (element.node !== this.node.childNodes[i]) {
            this.node.insertBefore(element.node, this.node.childNodes[i]);
          }

          return this;
        } // Add element to given container and return self

      }, {
        key: "addTo",
        value: function addTo(parent) {
          return makeInstance(parent).put(this);
        } // Returns all child elements

      }, {
        key: "children",
        value: function children() {
          return new List(map(this.node.children, function (node) {
            return adopt(node);
          }));
        } // Remove all elements in this container

      }, {
        key: "clear",
        value: function clear() {
          // remove children
          while (this.node.hasChildNodes()) {
            this.node.removeChild(this.node.lastChild);
          }

          return this;
        } // Clone element

      }, {
        key: "clone",
        value: function clone() {
          // write dom data to the dom so the clone can pickup the data
          this.writeDataToDom(); // clone element and assign new id

          return assignNewId(this.node.cloneNode(true));
        } // Iterates over all children and invokes a given block

      }, {
        key: "each",
        value: function each(block, deep) {
          var children = this.children();
          var i, il;

          for (i = 0, il = children.length; i < il; i++) {
            block.apply(children[i], [i, children]);

            if (deep) {
              children[i].each(block, deep);
            }
          }

          return this;
        }
      }, {
        key: "element",
        value: function element(nodeName) {
          return this.put(new Dom(create(nodeName)));
        } // Get first child

      }, {
        key: "first",
        value: function first() {
          return adopt(this.node.firstChild);
        } // Get a element at the given index

      }, {
        key: "get",
        value: function get(i) {
          return adopt(this.node.childNodes[i]);
        }
      }, {
        key: "getEventHolder",
        value: function getEventHolder() {
          return this.node;
        }
      }, {
        key: "getEventTarget",
        value: function getEventTarget() {
          return this.node;
        } // Checks if the given element is a child

      }, {
        key: "has",
        value: function has(element) {
          return this.index(element) >= 0;
        } // Get / set id

      }, {
        key: "id",
        value: function id(_id) {
          // generate new id if no id set
          if (typeof _id === 'undefined' && !this.node.id) {
            this.node.id = eid(this.type);
          } // dont't set directly width this.node.id to make `null` work correctly


          return this.attr('id', _id);
        } // Gets index of given element

      }, {
        key: "index",
        value: function index(element) {
          return [].slice.call(this.node.childNodes).indexOf(element.node);
        } // Get the last child

      }, {
        key: "last",
        value: function last() {
          return adopt(this.node.lastChild);
        } // matches the element vs a css selector

      }, {
        key: "matches",
        value: function matches(selector) {
          var el = this.node;
          return (el.matches || el.matchesSelector || el.msMatchesSelector || el.mozMatchesSelector || el.webkitMatchesSelector || el.oMatchesSelector).call(el, selector);
        } // Returns the parent element instance

      }, {
        key: "parent",
        value: function parent(type) {
          var parent = this; // check for parent

          if (!parent.node.parentNode) return null; // get parent element

          parent = adopt(parent.node.parentNode);
          if (!type) return parent; // loop trough ancestors if type is given

          while (parent) {
            if (typeof type === 'string' ? parent.matches(type) : parent instanceof type) return parent;
            if (!parent.node.parentNode || parent.node.parentNode.nodeName === '#document' || parent.node.parentNode.nodeName === '#document-fragment') return null; // #759, #720

            parent = adopt(parent.node.parentNode);
          }
        } // Basically does the same as `add()` but returns the added element instead

      }, {
        key: "put",
        value: function put(element, i) {
          this.add(element, i);
          return element;
        } // Add element to given container and return container

      }, {
        key: "putIn",
        value: function putIn(parent) {
          return makeInstance(parent).add(this);
        } // Remove element

      }, {
        key: "remove",
        value: function remove() {
          if (this.parent()) {
            this.parent().removeElement(this);
          }

          return this;
        } // Remove a given child

      }, {
        key: "removeElement",
        value: function removeElement(element) {
          this.node.removeChild(element.node);
          return this;
        } // Replace this with element

      }, {
        key: "replace",
        value: function replace(element) {
          element = makeInstance(element);
          this.node.parentNode.replaceChild(element.node, this.node);
          return element;
        }
      }, {
        key: "round",
        value: function round() {
          var precision = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 2;
          var map = arguments.length > 1 ? arguments[1] : undefined;
          var factor = Math.pow(10, precision);
          var attrs = this.attr(); // If we have no map, build one from attrs

          if (!map) {
            map = Object.keys(attrs);
          } // Holds rounded attributes


          var newAttrs = {};
          map.forEach(function (key) {
            newAttrs[key] = Math.round(attrs[key] * factor) / factor;
          });
          this.attr(newAttrs);
          return this;
        } // Return id on string conversion

      }, {
        key: "toString",
        value: function toString() {
          return this.id();
        } // Import raw svg

      }, {
        key: "svg",
        value: function svg(svgOrFn, outerHTML) {
          var well, len, fragment;

          if (svgOrFn === false) {
            outerHTML = false;
            svgOrFn = null;
          } // act as getter if no svg string is given


          if (svgOrFn == null || typeof svgOrFn === 'function') {
            // The default for exports is, that the outerNode is included
            outerHTML = outerHTML == null ? true : outerHTML; // write svgjs data to the dom

            this.writeDataToDom();
            var current = this; // An export modifier was passed

            if (svgOrFn != null) {
              current = adopt(current.node.cloneNode(true)); // If the user wants outerHTML we need to process this node, too

              if (outerHTML) {
                var result = svgOrFn(current);
                current = result || current; // The user does not want this node? Well, then he gets nothing

                if (result === false) return '';
              } // Deep loop through all children and apply modifier


              current.each(function () {
                var result = svgOrFn(this);

                var _this = result || this; // If modifier returns false, discard node


                if (result === false) {
                  this.remove(); // If modifier returns new node, use it
                } else if (result && this !== _this) {
                  this.replace(_this);
                }
              }, true);
            } // Return outer or inner content


            return outerHTML ? current.node.outerHTML : current.node.innerHTML;
          } // Act as setter if we got a string
          // The default for import is, that the current node is not replaced


          outerHTML = outerHTML == null ? false : outerHTML; // Create temporary holder

          well = globals$1.document.createElementNS(ns, 'svg');
          fragment = globals$1.document.createDocumentFragment(); // Dump raw svg

          well.innerHTML = svgOrFn; // Transplant nodes into the fragment

          for (len = well.children.length; len--;) {
            fragment.appendChild(well.firstElementChild);
          }

          var parent = this.parent(); // Add the whole fragment at once

          return outerHTML ? this.replace(fragment) && parent : this.add(fragment);
        }
      }, {
        key: "words",
        value: function words(text) {
          // This is faster than removing all children and adding a new one
          this.node.textContent = text;
          return this;
        } // write svgjs data to the dom

      }, {
        key: "writeDataToDom",
        value: function writeDataToDom() {
          // dump variables recursively
          this.each(function () {
            this.writeDataToDom();
          });
          return this;
        }
      }]);

      return Dom;
    }(EventTarget);
    extend(Dom, {
      attr: attr$1,
      find: find,
      findOne: findOne
    });
    register(Dom, 'Dom');

    var Element =
    /*#__PURE__*/
    function (_Dom) {
      _inherits(Element, _Dom);

      function Element(node, attrs) {
        var _this;

        _classCallCheck(this, Element);

        _this = _possibleConstructorReturn(this, _getPrototypeOf(Element).call(this, node, attrs)); // initialize data object

        _this.dom = {}; // create circular reference

        _this.node.instance = _assertThisInitialized(_this);

        if (node.hasAttribute('svgjs:data')) {
          // pull svgjs data from the dom (getAttributeNS doesn't work in html5)
          _this.setData(JSON.parse(node.getAttribute('svgjs:data')) || {});
        }

        return _this;
      } // Move element by its center


      _createClass(Element, [{
        key: "center",
        value: function center(x, y) {
          return this.cx(x).cy(y);
        } // Move by center over x-axis

      }, {
        key: "cx",
        value: function cx(x) {
          return x == null ? this.x() + this.width() / 2 : this.x(x - this.width() / 2);
        } // Move by center over y-axis

      }, {
        key: "cy",
        value: function cy(y) {
          return y == null ? this.y() + this.height() / 2 : this.y(y - this.height() / 2);
        } // Get defs

      }, {
        key: "defs",
        value: function defs() {
          return this.root().defs();
        } // Relative move over x and y axes

      }, {
        key: "dmove",
        value: function dmove(x, y) {
          return this.dx(x).dy(y);
        } // Relative move over x axis

      }, {
        key: "dx",
        value: function dx() {
          var x = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
          return this.x(new SVGNumber(x).plus(this.x()));
        } // Relative move over y axis

      }, {
        key: "dy",
        value: function dy() {
          var y = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
          return this.y(new SVGNumber(y).plus(this.y()));
        } // Get parent document

      }, {
        key: "root",
        value: function root$1() {
          var p = this.parent(getClass(root));
          return p && p.root();
        }
      }, {
        key: "getEventHolder",
        value: function getEventHolder() {
          return this;
        } // Set height of element

      }, {
        key: "height",
        value: function height(_height) {
          return this.attr('height', _height);
        } // Checks whether the given point inside the bounding box of the element

      }, {
        key: "inside",
        value: function inside(x, y) {
          var box = this.bbox();
          return x > box.x && y > box.y && x < box.x + box.width && y < box.y + box.height;
        } // Move element to given x and y values

      }, {
        key: "move",
        value: function move(x, y) {
          return this.x(x).y(y);
        } // return array of all ancestors of given type up to the root svg

      }, {
        key: "parents",
        value: function parents() {
          var until = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : globals$1.document;
          until = makeInstance(until);
          var parents = new List();
          var parent = this;

          while ((parent = parent.parent()) && parent.node !== until.node && parent.node !== globals$1.document) {
            parents.push(parent);
          }

          return parents;
        } // Get referenced element form attribute value

      }, {
        key: "reference",
        value: function reference$1(attr) {
          attr = this.attr(attr);
          if (!attr) return null;
          var m = attr.match(reference);
          return m ? makeInstance(m[1]) : null;
        } // set given data to the elements data property

      }, {
        key: "setData",
        value: function setData(o) {
          this.dom = o;
          return this;
        } // Set element size to given width and height

      }, {
        key: "size",
        value: function size(width, height) {
          var p = proportionalSize(this, width, height);
          return this.width(new SVGNumber(p.width)).height(new SVGNumber(p.height));
        } // Set width of element

      }, {
        key: "width",
        value: function width(_width) {
          return this.attr('width', _width);
        } // write svgjs data to the dom

      }, {
        key: "writeDataToDom",
        value: function writeDataToDom() {
          // remove previously set data
          this.node.removeAttribute('svgjs:data');

          if (Object.keys(this.dom).length) {
            this.node.setAttribute('svgjs:data', JSON.stringify(this.dom)); // see #428
          }

          return _get(_getPrototypeOf(Element.prototype), "writeDataToDom", this).call(this);
        } // Move over x-axis

      }, {
        key: "x",
        value: function x(_x) {
          return this.attr('x', _x);
        } // Move over y-axis

      }, {
        key: "y",
        value: function y(_y) {
          return this.attr('y', _y);
        }
      }]);

      return Element;
    }(Dom);
    extend(Element, {
      bbox: bbox,
      rbox: rbox,
      point: point,
      ctm: ctm,
      screenCTM: screenCTM
    });
    register(Element, 'Element');

    var sugar = {
      stroke: ['color', 'width', 'opacity', 'linecap', 'linejoin', 'miterlimit', 'dasharray', 'dashoffset'],
      fill: ['color', 'opacity', 'rule'],
      prefix: function prefix(t, a) {
        return a === 'color' ? t : t + '-' + a;
      }
    } // Add sugar for fill and stroke
    ;
    ['fill', 'stroke'].forEach(function (m) {
      var extension = {};
      var i;

      extension[m] = function (o) {
        if (typeof o === 'undefined') {
          return this.attr(m);
        }

        if (typeof o === 'string' || o instanceof Color || Color.isRgb(o) || o instanceof Element) {
          this.attr(m, o);
        } else {
          // set all attributes from sugar.fill and sugar.stroke list
          for (i = sugar[m].length - 1; i >= 0; i--) {
            if (o[sugar[m][i]] != null) {
              this.attr(sugar.prefix(m, sugar[m][i]), o[sugar[m][i]]);
            }
          }
        }

        return this;
      };

      registerMethods(['Element', 'Runner'], extension);
    });
    registerMethods(['Element', 'Runner'], {
      // Let the user set the matrix directly
      matrix: function matrix(mat, b, c, d, e, f) {
        // Act as a getter
        if (mat == null) {
          return new Matrix(this);
        } // Act as a setter, the user can pass a matrix or a set of numbers


        return this.attr('transform', new Matrix(mat, b, c, d, e, f));
      },
      // Map rotation to transform
      rotate: function rotate(angle, cx, cy) {
        return this.transform({
          rotate: angle,
          ox: cx,
          oy: cy
        }, true);
      },
      // Map skew to transform
      skew: function skew(x, y, cx, cy) {
        return arguments.length === 1 || arguments.length === 3 ? this.transform({
          skew: x,
          ox: y,
          oy: cx
        }, true) : this.transform({
          skew: [x, y],
          ox: cx,
          oy: cy
        }, true);
      },
      shear: function shear(lam, cx, cy) {
        return this.transform({
          shear: lam,
          ox: cx,
          oy: cy
        }, true);
      },
      // Map scale to transform
      scale: function scale(x, y, cx, cy) {
        return arguments.length === 1 || arguments.length === 3 ? this.transform({
          scale: x,
          ox: y,
          oy: cx
        }, true) : this.transform({
          scale: [x, y],
          ox: cx,
          oy: cy
        }, true);
      },
      // Map translate to transform
      translate: function translate(x, y) {
        return this.transform({
          translate: [x, y]
        }, true);
      },
      // Map relative translations to transform
      relative: function relative(x, y) {
        return this.transform({
          relative: [x, y]
        }, true);
      },
      // Map flip to transform
      flip: function flip(direction, around) {
        var directionString = typeof direction === 'string' ? direction : isFinite(direction) ? 'both' : 'both';
        var origin = direction === 'both' && isFinite(around) ? [around, around] : direction === 'x' ? [around, 0] : direction === 'y' ? [0, around] : isFinite(direction) ? [direction, direction] : [0, 0];
        return this.transform({
          flip: directionString,
          origin: origin
        }, true);
      },
      // Opacity
      opacity: function opacity(value) {
        return this.attr('opacity', value);
      }
    });
    registerMethods('radius', {
      // Add x and y radius
      radius: function radius(x, y) {
        var type = (this._element || this).type;
        return type === 'radialGradient' || type === 'radialGradient' ? this.attr('r', new SVGNumber(x)) : this.rx(x).ry(y == null ? x : y);
      }
    });
    registerMethods('Path', {
      // Get path length
      length: function length() {
        return this.node.getTotalLength();
      },
      // Get point at length
      pointAt: function pointAt(length) {
        return new Point(this.node.getPointAtLength(length));
      }
    });
    registerMethods(['Element', 'Runner'], {
      // Set font
      font: function font(a, v) {
        if (_typeof(a) === 'object') {
          for (v in a) {
            this.font(v, a[v]);
          }

          return this;
        }

        return a === 'leading' ? this.leading(v) : a === 'anchor' ? this.attr('text-anchor', v) : a === 'size' || a === 'family' || a === 'weight' || a === 'stretch' || a === 'variant' || a === 'style' ? this.attr('font-' + a, v) : this.attr(a, v);
      }
    });
    registerMethods('Text', {
      ax: function ax(x) {
        return this.attr('x', x);
      },
      ay: function ay(y) {
        return this.attr('y', y);
      },
      amove: function amove(x, y) {
        return this.ax(x).ay(y);
      }
    }); // Add events to elements

    var methods$1 = ['click', 'dblclick', 'mousedown', 'mouseup', 'mouseover', 'mouseout', 'mousemove', 'mouseenter', 'mouseleave', 'touchstart', 'touchmove', 'touchleave', 'touchend', 'touchcancel'].reduce(function (last, event) {
      // add event to Element
      var fn = function fn(f) {
        if (f === null) {
          off(this, event);
        } else {
          on(this, event, f);
        }

        return this;
      };

      last[event] = fn;
      return last;
    }, {});
    registerMethods('Element', methods$1);

    var nativeReverse = [].reverse;
    var test$1 = [1, 2];

    // `Array.prototype.reverse` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.reverse
    // fix for Safari 12.0 bug
    // https://bugs.webkit.org/show_bug.cgi?id=188794
    _export({ target: 'Array', proto: true, forced: String(test$1) === String(test$1.reverse()) }, {
      reverse: function reverse() {
        // eslint-disable-next-line no-self-assign
        if (isArray(this)) this.length = this.length;
        return nativeReverse.call(this);
      }
    });

    // `Object.defineProperties` method
    // https://tc39.github.io/ecma262/#sec-object.defineproperties
    _export({ target: 'Object', stat: true, forced: !descriptors, sham: !descriptors }, {
      defineProperties: objectDefineProperties
    });

    // `Object.defineProperty` method
    // https://tc39.github.io/ecma262/#sec-object.defineproperty
    _export({ target: 'Object', stat: true, forced: !descriptors, sham: !descriptors }, {
      defineProperty: objectDefineProperty.f
    });

    var nativeGetOwnPropertyDescriptor$2 = objectGetOwnPropertyDescriptor.f;


    var FAILS_ON_PRIMITIVES$2 = fails(function () { nativeGetOwnPropertyDescriptor$2(1); });
    var FORCED$3 = !descriptors || FAILS_ON_PRIMITIVES$2;

    // `Object.getOwnPropertyDescriptor` method
    // https://tc39.github.io/ecma262/#sec-object.getownpropertydescriptor
    _export({ target: 'Object', stat: true, forced: FORCED$3, sham: !descriptors }, {
      getOwnPropertyDescriptor: function getOwnPropertyDescriptor(it, key) {
        return nativeGetOwnPropertyDescriptor$2(toIndexedObject(it), key);
      }
    });

    // `Object.getOwnPropertyDescriptors` method
    // https://tc39.github.io/ecma262/#sec-object.getownpropertydescriptors
    _export({ target: 'Object', stat: true, sham: !descriptors }, {
      getOwnPropertyDescriptors: function getOwnPropertyDescriptors(object) {
        var O = toIndexedObject(object);
        var getOwnPropertyDescriptor = objectGetOwnPropertyDescriptor.f;
        var keys = ownKeys(O);
        var result = {};
        var index = 0;
        var key, descriptor;
        while (keys.length > index) {
          descriptor = getOwnPropertyDescriptor(O, key = keys[index++]);
          if (descriptor !== undefined) createProperty(result, key, descriptor);
        }
        return result;
      }
    });

    function _defineProperty(obj, key, value) {
      if (key in obj) {
        Object.defineProperty(obj, key, {
          value: value,
          enumerable: true,
          configurable: true,
          writable: true
        });
      } else {
        obj[key] = value;
      }

      return obj;
    }

    function ownKeys$1(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

    function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys$1(source, true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys$1(source).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

    function untransform() {
      return this.attr('transform', null);
    } // merge the whole transformation chain into one matrix and returns it

    function matrixify() {
      var matrix = (this.attr('transform') || ''). // split transformations
      split(transforms).slice(0, -1).map(function (str) {
        // generate key => value pairs
        var kv = str.trim().split('(');
        return [kv[0], kv[1].split(delimiter).map(function (str) {
          return parseFloat(str);
        })];
      }).reverse() // merge every transformation into one matrix
      .reduce(function (matrix, transform) {
        if (transform[0] === 'matrix') {
          return matrix.lmultiply(Matrix.fromArray(transform[1]));
        }

        return matrix[transform[0]].apply(matrix, transform[1]);
      }, new Matrix());
      return matrix;
    } // add an element to another parent without changing the visual representation on the screen

    function toParent(parent) {
      if (this === parent) return this;
      var ctm = this.screenCTM();
      var pCtm = parent.screenCTM().inverse();
      this.addTo(parent).untransform().transform(pCtm.multiply(ctm));
      return this;
    } // same as above with parent equals root-svg

    function toRoot() {
      return this.toParent(this.root());
    } // Add transformations

    function transform(o, relative) {
      // Act as a getter if no object was passed
      if (o == null || typeof o === 'string') {
        var decomposed = new Matrix(this).decompose();
        return o == null ? decomposed : decomposed[o];
      }

      if (!Matrix.isMatrixLike(o)) {
        // Set the origin according to the defined transform
        o = _objectSpread({}, o, {
          origin: getOrigin(o, this)
        });
      } // The user can pass a boolean, an Element or an Matrix or nothing


      var cleanRelative = relative === true ? this : relative || false;
      var result = new Matrix(cleanRelative).transform(o);
      return this.attr('transform', result);
    }
    registerMethods('Element', {
      untransform: untransform,
      matrixify: matrixify,
      toParent: toParent,
      toRoot: toRoot,
      transform: transform
    });

    function rx(rx) {
      return this.attr('rx', rx);
    } // Radius y value

    function ry(ry) {
      return this.attr('ry', ry);
    } // Move over x-axis

    function x(x) {
      return x == null ? this.cx() - this.rx() : this.cx(x + this.rx());
    } // Move over y-axis

    function y(y) {
      return y == null ? this.cy() - this.ry() : this.cy(y + this.ry());
    } // Move by center over x-axis

    function cx(x) {
      return x == null ? this.attr('cx') : this.attr('cx', x);
    } // Move by center over y-axis

    function cy(y) {
      return y == null ? this.attr('cy') : this.attr('cy', y);
    } // Set width of element

    function width(width) {
      return width == null ? this.rx() * 2 : this.rx(new SVGNumber(width).divide(2));
    } // Set height of element

    function height(height) {
      return height == null ? this.ry() * 2 : this.ry(new SVGNumber(height).divide(2));
    }

    var circled = ({
    	__proto__: null,
    	rx: rx,
    	ry: ry,
    	x: x,
    	y: y,
    	cx: cx,
    	cy: cy,
    	width: width,
    	height: height
    });

    var Shape =
    /*#__PURE__*/
    function (_Element) {
      _inherits(Shape, _Element);

      function Shape() {
        _classCallCheck(this, Shape);

        return _possibleConstructorReturn(this, _getPrototypeOf(Shape).apply(this, arguments));
      }

      return Shape;
    }(Element);
    register(Shape, 'Shape');

    var Circle =
    /*#__PURE__*/
    function (_Shape) {
      _inherits(Circle, _Shape);

      function Circle(node) {
        _classCallCheck(this, Circle);

        return _possibleConstructorReturn(this, _getPrototypeOf(Circle).call(this, nodeOrNew('circle', node), node));
      }

      _createClass(Circle, [{
        key: "radius",
        value: function radius(r) {
          return this.attr('r', r);
        } // Radius x value

      }, {
        key: "rx",
        value: function rx(_rx) {
          return this.attr('r', _rx);
        } // Alias radius x value

      }, {
        key: "ry",
        value: function ry(_ry) {
          return this.rx(_ry);
        }
      }, {
        key: "size",
        value: function size(_size) {
          return this.radius(new SVGNumber(_size).divide(2));
        }
      }]);

      return Circle;
    }(Shape);
    extend(Circle, {
      x: x,
      y: y,
      cx: cx,
      cy: cy,
      width: width,
      height: height
    });
    registerMethods({
      Container: {
        // Create circle element
        circle: wrapWithAttrCheck(function (size) {
          return this.put(new Circle()).size(size).move(0, 0);
        })
      }
    });
    register(Circle, 'Circle');

    var Container =
    /*#__PURE__*/
    function (_Element) {
      _inherits(Container, _Element);

      function Container() {
        _classCallCheck(this, Container);

        return _possibleConstructorReturn(this, _getPrototypeOf(Container).apply(this, arguments));
      }

      _createClass(Container, [{
        key: "flatten",
        value: function flatten(parent) {
          this.each(function () {
            if (this instanceof Container) return this.flatten(parent).ungroup(parent);
            return this.toParent(parent);
          }); // we need this so that the root does not get removed

          this.node.firstElementChild || this.remove();
          return this;
        }
      }, {
        key: "ungroup",
        value: function ungroup(parent) {
          parent = parent || this.parent();
          this.each(function () {
            return this.toParent(parent);
          });
          this.remove();
          return this;
        }
      }]);

      return Container;
    }(Element);
    register(Container, 'Container');

    var Defs =
    /*#__PURE__*/
    function (_Container) {
      _inherits(Defs, _Container);

      function Defs(node) {
        _classCallCheck(this, Defs);

        return _possibleConstructorReturn(this, _getPrototypeOf(Defs).call(this, nodeOrNew('defs', node), node));
      }

      _createClass(Defs, [{
        key: "flatten",
        value: function flatten() {
          return this;
        }
      }, {
        key: "ungroup",
        value: function ungroup() {
          return this;
        }
      }]);

      return Defs;
    }(Container);
    register(Defs, 'Defs');

    var Ellipse =
    /*#__PURE__*/
    function (_Shape) {
      _inherits(Ellipse, _Shape);

      function Ellipse(node) {
        _classCallCheck(this, Ellipse);

        return _possibleConstructorReturn(this, _getPrototypeOf(Ellipse).call(this, nodeOrNew('ellipse', node), node));
      }

      _createClass(Ellipse, [{
        key: "size",
        value: function size(width, height) {
          var p = proportionalSize(this, width, height);
          return this.rx(new SVGNumber(p.width).divide(2)).ry(new SVGNumber(p.height).divide(2));
        }
      }]);

      return Ellipse;
    }(Shape);
    extend(Ellipse, circled);
    registerMethods('Container', {
      // Create an ellipse
      ellipse: wrapWithAttrCheck(function () {
        var width = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
        var height = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : width;
        return this.put(new Ellipse()).size(width, height).move(0, 0);
      })
    });
    register(Ellipse, 'Ellipse');

    var Stop =
    /*#__PURE__*/
    function (_Element) {
      _inherits(Stop, _Element);

      function Stop(node) {
        _classCallCheck(this, Stop);

        return _possibleConstructorReturn(this, _getPrototypeOf(Stop).call(this, nodeOrNew('stop', node), node));
      } // add color stops


      _createClass(Stop, [{
        key: "update",
        value: function update(o) {
          if (typeof o === 'number' || o instanceof SVGNumber) {
            o = {
              offset: arguments[0],
              color: arguments[1],
              opacity: arguments[2]
            };
          } // set attributes


          if (o.opacity != null) this.attr('stop-opacity', o.opacity);
          if (o.color != null) this.attr('stop-color', o.color);
          if (o.offset != null) this.attr('offset', new SVGNumber(o.offset));
          return this;
        }
      }]);

      return Stop;
    }(Element);
    register(Stop, 'Stop');

    function from(x, y) {
      return (this._element || this).type === 'radialGradient' ? this.attr({
        fx: new SVGNumber(x),
        fy: new SVGNumber(y)
      }) : this.attr({
        x1: new SVGNumber(x),
        y1: new SVGNumber(y)
      });
    }
    function to(x, y) {
      return (this._element || this).type === 'radialGradient' ? this.attr({
        cx: new SVGNumber(x),
        cy: new SVGNumber(y)
      }) : this.attr({
        x2: new SVGNumber(x),
        y2: new SVGNumber(y)
      });
    }

    var gradiented = ({
    	__proto__: null,
    	from: from,
    	to: to
    });

    var Gradient =
    /*#__PURE__*/
    function (_Container) {
      _inherits(Gradient, _Container);

      function Gradient(type, attrs) {
        _classCallCheck(this, Gradient);

        return _possibleConstructorReturn(this, _getPrototypeOf(Gradient).call(this, nodeOrNew(type + 'Gradient', typeof type === 'string' ? null : type), attrs));
      } // Add a color stop


      _createClass(Gradient, [{
        key: "stop",
        value: function stop(offset, color, opacity) {
          return this.put(new Stop()).update(offset, color, opacity);
        } // Update gradient

      }, {
        key: "update",
        value: function update(block) {
          // remove all stops
          this.clear(); // invoke passed block

          if (typeof block === 'function') {
            block.call(this, this);
          }

          return this;
        } // Return the fill id

      }, {
        key: "url",
        value: function url() {
          return 'url(#' + this.id() + ')';
        } // Alias string convertion to fill

      }, {
        key: "toString",
        value: function toString() {
          return this.url();
        } // custom attr to handle transform

      }, {
        key: "attr",
        value: function attr(a, b, c) {
          if (a === 'transform') a = 'gradientTransform';
          return _get(_getPrototypeOf(Gradient.prototype), "attr", this).call(this, a, b, c);
        }
      }, {
        key: "targets",
        value: function targets() {
          return baseFind('svg [fill*="' + this.id() + '"]');
        }
      }, {
        key: "bbox",
        value: function bbox() {
          return new Box();
        }
      }]);

      return Gradient;
    }(Container);
    extend(Gradient, gradiented);
    registerMethods({
      Container: {
        // Create gradient element in defs
        gradient: wrapWithAttrCheck(function (type, block) {
          return this.defs().gradient(type, block);
        })
      },
      // define gradient
      Defs: {
        gradient: wrapWithAttrCheck(function (type, block) {
          return this.put(new Gradient(type)).update(block);
        })
      }
    });
    register(Gradient, 'Gradient');

    var Pattern =
    /*#__PURE__*/
    function (_Container) {
      _inherits(Pattern, _Container);

      // Initialize node
      function Pattern(node) {
        _classCallCheck(this, Pattern);

        return _possibleConstructorReturn(this, _getPrototypeOf(Pattern).call(this, nodeOrNew('pattern', node), node));
      } // Return the fill id


      _createClass(Pattern, [{
        key: "url",
        value: function url() {
          return 'url(#' + this.id() + ')';
        } // Update pattern by rebuilding

      }, {
        key: "update",
        value: function update(block) {
          // remove content
          this.clear(); // invoke passed block

          if (typeof block === 'function') {
            block.call(this, this);
          }

          return this;
        } // Alias string convertion to fill

      }, {
        key: "toString",
        value: function toString() {
          return this.url();
        } // custom attr to handle transform

      }, {
        key: "attr",
        value: function attr(a, b, c) {
          if (a === 'transform') a = 'patternTransform';
          return _get(_getPrototypeOf(Pattern.prototype), "attr", this).call(this, a, b, c);
        }
      }, {
        key: "targets",
        value: function targets() {
          return baseFind('svg [fill*="' + this.id() + '"]');
        }
      }, {
        key: "bbox",
        value: function bbox() {
          return new Box();
        }
      }]);

      return Pattern;
    }(Container);
    registerMethods({
      Container: {
        // Create pattern element in defs
        pattern: function pattern() {
          var _this$defs;

          return (_this$defs = this.defs()).pattern.apply(_this$defs, arguments);
        }
      },
      Defs: {
        pattern: wrapWithAttrCheck(function (width, height, block) {
          return this.put(new Pattern()).update(block).attr({
            x: 0,
            y: 0,
            width: width,
            height: height,
            patternUnits: 'userSpaceOnUse'
          });
        })
      }
    });
    register(Pattern, 'Pattern');

    var Image =
    /*#__PURE__*/
    function (_Shape) {
      _inherits(Image, _Shape);

      function Image(node) {
        _classCallCheck(this, Image);

        return _possibleConstructorReturn(this, _getPrototypeOf(Image).call(this, nodeOrNew('image', node), node));
      } // (re)load image


      _createClass(Image, [{
        key: "load",
        value: function load(url, callback) {
          if (!url) return this;
          var img = new globals$1.window.Image();
          on(img, 'load', function (e) {
            var p = this.parent(Pattern); // ensure image size

            if (this.width() === 0 && this.height() === 0) {
              this.size(img.width, img.height);
            }

            if (p instanceof Pattern) {
              // ensure pattern size if not set
              if (p.width() === 0 && p.height() === 0) {
                p.size(this.width(), this.height());
              }
            }

            if (typeof callback === 'function') {
              callback.call(this, e);
            }
          }, this);
          on(img, 'load error', function () {
            // dont forget to unbind memory leaking events
            off(img);
          });
          return this.attr('href', img.src = url, xlink);
        }
      }]);

      return Image;
    }(Shape);
    registerAttrHook(function (attr, val, _this) {
      // convert image fill and stroke to patterns
      if (attr === 'fill' || attr === 'stroke') {
        if (isImage.test(val)) {
          val = _this.root().defs().image(val);
        }
      }

      if (val instanceof Image) {
        val = _this.root().defs().pattern(0, 0, function (pattern) {
          pattern.add(val);
        });
      }

      return val;
    });
    registerMethods({
      Container: {
        // create image element, load image and set its size
        image: wrapWithAttrCheck(function (source, callback) {
          return this.put(new Image()).size(0, 0).load(source, callback);
        })
      }
    });
    register(Image, 'Image');

    var PointArray = subClassArray('PointArray', SVGArray);
    extend(PointArray, {
      // Convert array to string
      toString: function toString() {
        // convert to a poly point string
        for (var i = 0, il = this.length, array = []; i < il; i++) {
          array.push(this[i].join(','));
        }

        return array.join(' ');
      },
      // Convert array to line object
      toLine: function toLine() {
        return {
          x1: this[0][0],
          y1: this[0][1],
          x2: this[1][0],
          y2: this[1][1]
        };
      },
      // Get morphed array at given position
      at: function at(pos) {
        // make sure a destination is defined
        if (!this.destination) return this; // generate morphed point string

        for (var i = 0, il = this.length, array = []; i < il; i++) {
          array.push([this[i][0] + (this.destination[i][0] - this[i][0]) * pos, this[i][1] + (this.destination[i][1] - this[i][1]) * pos]);
        }

        return new PointArray(array);
      },
      // Parse point string and flat array
      parse: function parse() {
        var array = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [[0, 0]];
        var points = []; // if it is an array

        if (array instanceof Array) {
          // and it is not flat, there is no need to parse it
          if (array[0] instanceof Array) {
            return array;
          }
        } else {
          // Else, it is considered as a string
          // parse points
          array = array.trim().split(delimiter).map(parseFloat);
        } // validate points - https://svgwg.org/svg2-draft/shapes.html#DataTypePoints
        // Odd number of coordinates is an error. In such cases, drop the last odd coordinate.


        if (array.length % 2 !== 0) array.pop(); // wrap points in two-tuples

        for (var i = 0, len = array.length; i < len; i = i + 2) {
          points.push([array[i], array[i + 1]]);
        }

        return points;
      },
      // transform points with matrix (similar to Point.transform)
      transform: function transform(m) {
        var points = [];

        for (var i = 0; i < this.length; i++) {
          var point = this[i]; // Perform the matrix multiplication

          points.push([m.a * point[0] + m.c * point[1] + m.e, m.b * point[0] + m.d * point[1] + m.f]);
        } // Return the required point


        return new PointArray(points);
      },
      // Move point string
      move: function move(x, y) {
        var box = this.bbox(); // get relative offset

        x -= box.x;
        y -= box.y; // move every point

        if (!isNaN(x) && !isNaN(y)) {
          for (var i = this.length - 1; i >= 0; i--) {
            this[i] = [this[i][0] + x, this[i][1] + y];
          }
        }

        return this;
      },
      // Resize poly string
      size: function size(width, height) {
        var i;
        var box = this.bbox(); // recalculate position of all points according to new size

        for (i = this.length - 1; i >= 0; i--) {
          if (box.width) this[i][0] = (this[i][0] - box.x) * width / box.width + box.x;
          if (box.height) this[i][1] = (this[i][1] - box.y) * height / box.height + box.y;
        }

        return this;
      },
      // Get bounding box of points
      bbox: function bbox() {
        var maxX = -Infinity;
        var maxY = -Infinity;
        var minX = Infinity;
        var minY = Infinity;
        this.forEach(function (el) {
          maxX = Math.max(el[0], maxX);
          maxY = Math.max(el[1], maxY);
          minX = Math.min(el[0], minX);
          minY = Math.min(el[1], minY);
        });
        return {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY
        };
      }
    });

    var MorphArray = PointArray; // Move by left top corner over x-axis

    function x$1(x) {
      return x == null ? this.bbox().x : this.move(x, this.bbox().y);
    } // Move by left top corner over y-axis

    function y$1(y) {
      return y == null ? this.bbox().y : this.move(this.bbox().x, y);
    } // Set width of element

    function width$1(width) {
      var b = this.bbox();
      return width == null ? b.width : this.size(width, b.height);
    } // Set height of element

    function height$1(height) {
      var b = this.bbox();
      return height == null ? b.height : this.size(b.width, height);
    }

    var pointed = ({
    	__proto__: null,
    	MorphArray: MorphArray,
    	x: x$1,
    	y: y$1,
    	width: width$1,
    	height: height$1
    });

    var Line =
    /*#__PURE__*/
    function (_Shape) {
      _inherits(Line, _Shape);

      // Initialize node
      function Line(node) {
        _classCallCheck(this, Line);

        return _possibleConstructorReturn(this, _getPrototypeOf(Line).call(this, nodeOrNew('line', node), node));
      } // Get array


      _createClass(Line, [{
        key: "array",
        value: function array() {
          return new PointArray([[this.attr('x1'), this.attr('y1')], [this.attr('x2'), this.attr('y2')]]);
        } // Overwrite native plot() method

      }, {
        key: "plot",
        value: function plot(x1, y1, x2, y2) {
          if (x1 == null) {
            return this.array();
          } else if (typeof y1 !== 'undefined') {
            x1 = {
              x1: x1,
              y1: y1,
              x2: x2,
              y2: y2
            };
          } else {
            x1 = new PointArray(x1).toLine();
          }

          return this.attr(x1);
        } // Move by left top corner

      }, {
        key: "move",
        value: function move(x, y) {
          return this.attr(this.array().move(x, y).toLine());
        } // Set element size to given width and height

      }, {
        key: "size",
        value: function size(width, height) {
          var p = proportionalSize(this, width, height);
          return this.attr(this.array().size(p.width, p.height).toLine());
        }
      }]);

      return Line;
    }(Shape);
    extend(Line, pointed);
    registerMethods({
      Container: {
        // Create a line element
        line: wrapWithAttrCheck(function () {
          for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
            args[_key] = arguments[_key];
          }

          // make sure plot is called as a setter
          // x1 is not necessarily a number, it can also be an array, a string and a PointArray
          return Line.prototype.plot.apply(this.put(new Line()), args[0] != null ? args : [0, 0, 0, 0]);
        })
      }
    });
    register(Line, 'Line');

    var Marker =
    /*#__PURE__*/
    function (_Container) {
      _inherits(Marker, _Container);

      // Initialize node
      function Marker(node) {
        _classCallCheck(this, Marker);

        return _possibleConstructorReturn(this, _getPrototypeOf(Marker).call(this, nodeOrNew('marker', node), node));
      } // Set width of element


      _createClass(Marker, [{
        key: "width",
        value: function width(_width) {
          return this.attr('markerWidth', _width);
        } // Set height of element

      }, {
        key: "height",
        value: function height(_height) {
          return this.attr('markerHeight', _height);
        } // Set marker refX and refY

      }, {
        key: "ref",
        value: function ref(x, y) {
          return this.attr('refX', x).attr('refY', y);
        } // Update marker

      }, {
        key: "update",
        value: function update(block) {
          // remove all content
          this.clear(); // invoke passed block

          if (typeof block === 'function') {
            block.call(this, this);
          }

          return this;
        } // Return the fill id

      }, {
        key: "toString",
        value: function toString() {
          return 'url(#' + this.id() + ')';
        }
      }]);

      return Marker;
    }(Container);
    registerMethods({
      Container: {
        marker: function marker() {
          var _this$defs;

          // Create marker element in defs
          return (_this$defs = this.defs()).marker.apply(_this$defs, arguments);
        }
      },
      Defs: {
        // Create marker
        marker: wrapWithAttrCheck(function (width, height, block) {
          // Set default viewbox to match the width and height, set ref to cx and cy and set orient to auto
          return this.put(new Marker()).size(width, height).ref(width / 2, height / 2).viewbox(0, 0, width, height).attr('orient', 'auto').update(block);
        })
      },
      marker: {
        // Create and attach markers
        marker: function marker(_marker, width, height, block) {
          var attr = ['marker']; // Build attribute name

          if (_marker !== 'all') attr.push(_marker);
          attr = attr.join('-'); // Set marker attribute

          _marker = arguments[1] instanceof Marker ? arguments[1] : this.defs().marker(width, height, block);
          return this.attr(attr, _marker);
        }
      }
    });
    register(Marker, 'Marker');

    var nativeSort = [].sort;
    var test$2 = [1, 2, 3];

    // IE8-
    var FAILS_ON_UNDEFINED = fails(function () {
      test$2.sort(undefined);
    });
    // V8 bug
    var FAILS_ON_NULL = fails(function () {
      test$2.sort(null);
    });
    // Old WebKit
    var SLOPPY_METHOD$2 = sloppyArrayMethod('sort');

    var FORCED$4 = FAILS_ON_UNDEFINED || !FAILS_ON_NULL || SLOPPY_METHOD$2;

    // `Array.prototype.sort` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.sort
    _export({ target: 'Array', proto: true, forced: FORCED$4 }, {
      sort: function sort(comparefn) {
        return comparefn === undefined
          ? nativeSort.call(toObject(this))
          : nativeSort.call(toObject(this), aFunction$1(comparefn));
      }
    });

    /***
    Base Class
    ==========
    The base stepper class that will be
    ***/

    function makeSetterGetter(k, f) {
      return function (v) {
        if (v == null) return this[v];
        this[k] = v;
        if (f) f.call(this);
        return this;
      };
    }

    var easing = {
      '-': function _(pos) {
        return pos;
      },
      '<>': function _(pos) {
        return -Math.cos(pos * Math.PI) / 2 + 0.5;
      },
      '>': function _(pos) {
        return Math.sin(pos * Math.PI / 2);
      },
      '<': function _(pos) {
        return -Math.cos(pos * Math.PI / 2) + 1;
      },
      bezier: function bezier(x1, y1, x2, y2) {
        // see https://www.w3.org/TR/css-easing-1/#cubic-bezier-algo
        return function (t) {
          if (t < 0) {
            if (x1 > 0) {
              return y1 / x1 * t;
            } else if (x2 > 0) {
              return y2 / x2 * t;
            } else {
              return 0;
            }
          } else if (t > 1) {
            if (x2 < 1) {
              return (1 - y2) / (1 - x2) * t + (y2 - x2) / (1 - x2);
            } else if (x1 < 1) {
              return (1 - y1) / (1 - x1) * t + (y1 - x1) / (1 - x1);
            } else {
              return 1;
            }
          } else {
            return 3 * t * Math.pow(1 - t, 2) * y1 + 3 * Math.pow(t, 2) * (1 - t) * y2 + Math.pow(t, 3);
          }
        };
      },
      // see https://www.w3.org/TR/css-easing-1/#step-timing-function-algo
      steps: function steps(_steps) {
        var stepPosition = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 'end';
        // deal with "jump-" prefix
        stepPosition = stepPosition.split('-').reverse()[0];
        var jumps = _steps;

        if (stepPosition === 'none') {
          --jumps;
        } else if (stepPosition === 'both') {
          ++jumps;
        } // The beforeFlag is essentially useless


        return function (t) {
          var beforeFlag = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
          // Step is called currentStep in referenced url
          var step = Math.floor(t * _steps);
          var jumping = t * step % 1 === 0;

          if (stepPosition === 'start' || stepPosition === 'both') {
            ++step;
          }

          if (beforeFlag && jumping) {
            --step;
          }

          if (t >= 0 && step < 0) {
            step = 0;
          }

          if (t <= 1 && step > jumps) {
            step = jumps;
          }

          return step / jumps;
        };
      }
    };
    var Stepper =
    /*#__PURE__*/
    function () {
      function Stepper() {
        _classCallCheck(this, Stepper);
      }

      _createClass(Stepper, [{
        key: "done",
        value: function done() {
          return false;
        }
      }]);

      return Stepper;
    }();
    /***
    Easing Functions
    ================
    ***/

    var Ease =
    /*#__PURE__*/
    function (_Stepper) {
      _inherits(Ease, _Stepper);

      function Ease(fn) {
        var _this;

        _classCallCheck(this, Ease);

        _this = _possibleConstructorReturn(this, _getPrototypeOf(Ease).call(this));
        _this.ease = easing[fn || timeline.ease] || fn;
        return _this;
      }

      _createClass(Ease, [{
        key: "step",
        value: function step(from, to, pos) {
          if (typeof from !== 'number') {
            return pos < 1 ? from : to;
          }

          return from + (to - from) * this.ease(pos);
        }
      }]);

      return Ease;
    }(Stepper);
    /***
    Controller Types
    ================
    ***/

    var Controller =
    /*#__PURE__*/
    function (_Stepper2) {
      _inherits(Controller, _Stepper2);

      function Controller(fn) {
        var _this2;

        _classCallCheck(this, Controller);

        _this2 = _possibleConstructorReturn(this, _getPrototypeOf(Controller).call(this));
        _this2.stepper = fn;
        return _this2;
      }

      _createClass(Controller, [{
        key: "step",
        value: function step(current, target, dt, c) {
          return this.stepper(current, target, dt, c);
        }
      }, {
        key: "done",
        value: function done(c) {
          return c.done;
        }
      }]);

      return Controller;
    }(Stepper);

    function recalculate() {
      // Apply the default parameters
      var duration = (this._duration || 500) / 1000;
      var overshoot = this._overshoot || 0; // Calculate the PID natural response

      var eps = 1e-10;
      var pi = Math.PI;
      var os = Math.log(overshoot / 100 + eps);
      var zeta = -os / Math.sqrt(pi * pi + os * os);
      var wn = 3.9 / (zeta * duration); // Calculate the Spring values

      this.d = 2 * zeta * wn;
      this.k = wn * wn;
    }

    var Spring =
    /*#__PURE__*/
    function (_Controller) {
      _inherits(Spring, _Controller);

      function Spring(duration, overshoot) {
        var _this3;

        _classCallCheck(this, Spring);

        _this3 = _possibleConstructorReturn(this, _getPrototypeOf(Spring).call(this));

        _this3.duration(duration || 500).overshoot(overshoot || 0);

        return _this3;
      }

      _createClass(Spring, [{
        key: "step",
        value: function step(current, target, dt, c) {
          if (typeof current === 'string') return current;
          c.done = dt === Infinity;
          if (dt === Infinity) return target;
          if (dt === 0) return current;
          if (dt > 100) dt = 16;
          dt /= 1000; // Get the previous velocity

          var velocity = c.velocity || 0; // Apply the control to get the new position and store it

          var acceleration = -this.d * velocity - this.k * (current - target);
          var newPosition = current + velocity * dt + acceleration * dt * dt / 2; // Store the velocity

          c.velocity = velocity + acceleration * dt; // Figure out if we have converged, and if so, pass the value

          c.done = Math.abs(target - newPosition) + Math.abs(velocity) < 0.002;
          return c.done ? target : newPosition;
        }
      }]);

      return Spring;
    }(Controller);
    extend(Spring, {
      duration: makeSetterGetter('_duration', recalculate),
      overshoot: makeSetterGetter('_overshoot', recalculate)
    });
    var PID =
    /*#__PURE__*/
    function (_Controller2) {
      _inherits(PID, _Controller2);

      function PID(p, i, d, windup) {
        var _this4;

        _classCallCheck(this, PID);

        _this4 = _possibleConstructorReturn(this, _getPrototypeOf(PID).call(this));
        p = p == null ? 0.1 : p;
        i = i == null ? 0.01 : i;
        d = d == null ? 0 : d;
        windup = windup == null ? 1000 : windup;

        _this4.p(p).i(i).d(d).windup(windup);

        return _this4;
      }

      _createClass(PID, [{
        key: "step",
        value: function step(current, target, dt, c) {
          if (typeof current === 'string') return current;
          c.done = dt === Infinity;
          if (dt === Infinity) return target;
          if (dt === 0) return current;
          var p = target - current;
          var i = (c.integral || 0) + p * dt;
          var d = (p - (c.error || 0)) / dt;
          var windup = this.windup; // antiwindup

          if (windup !== false) {
            i = Math.max(-windup, Math.min(i, windup));
          }

          c.error = p;
          c.integral = i;
          c.done = Math.abs(p) < 0.001;
          return c.done ? target : current + (this.P * p + this.I * i + this.D * d);
        }
      }]);

      return PID;
    }(Controller);
    extend(PID, {
      windup: makeSetterGetter('windup'),
      p: makeSetterGetter('P'),
      i: makeSetterGetter('I'),
      d: makeSetterGetter('D')
    });

    var PathArray = subClassArray('PathArray', SVGArray);
    function pathRegReplace(a, b, c, d) {
      return c + d.replace(dots, ' .');
    }

    function arrayToString(a) {
      for (var i = 0, il = a.length, s = ''; i < il; i++) {
        s += a[i][0];

        if (a[i][1] != null) {
          s += a[i][1];

          if (a[i][2] != null) {
            s += ' ';
            s += a[i][2];

            if (a[i][3] != null) {
              s += ' ';
              s += a[i][3];
              s += ' ';
              s += a[i][4];

              if (a[i][5] != null) {
                s += ' ';
                s += a[i][5];
                s += ' ';
                s += a[i][6];

                if (a[i][7] != null) {
                  s += ' ';
                  s += a[i][7];
                }
              }
            }
          }
        }
      }

      return s + ' ';
    }

    var pathHandlers = {
      M: function M(c, p, p0) {
        p.x = p0.x = c[0];
        p.y = p0.y = c[1];
        return ['M', p.x, p.y];
      },
      L: function L(c, p) {
        p.x = c[0];
        p.y = c[1];
        return ['L', c[0], c[1]];
      },
      H: function H(c, p) {
        p.x = c[0];
        return ['H', c[0]];
      },
      V: function V(c, p) {
        p.y = c[0];
        return ['V', c[0]];
      },
      C: function C(c, p) {
        p.x = c[4];
        p.y = c[5];
        return ['C', c[0], c[1], c[2], c[3], c[4], c[5]];
      },
      S: function S(c, p) {
        p.x = c[2];
        p.y = c[3];
        return ['S', c[0], c[1], c[2], c[3]];
      },
      Q: function Q(c, p) {
        p.x = c[2];
        p.y = c[3];
        return ['Q', c[0], c[1], c[2], c[3]];
      },
      T: function T(c, p) {
        p.x = c[0];
        p.y = c[1];
        return ['T', c[0], c[1]];
      },
      Z: function Z(c, p, p0) {
        p.x = p0.x;
        p.y = p0.y;
        return ['Z'];
      },
      A: function A(c, p) {
        p.x = c[5];
        p.y = c[6];
        return ['A', c[0], c[1], c[2], c[3], c[4], c[5], c[6]];
      }
    };
    var mlhvqtcsaz = 'mlhvqtcsaz'.split('');

    for (var i = 0, il = mlhvqtcsaz.length; i < il; ++i) {
      pathHandlers[mlhvqtcsaz[i]] = function (i) {
        return function (c, p, p0) {
          if (i === 'H') c[0] = c[0] + p.x;else if (i === 'V') c[0] = c[0] + p.y;else if (i === 'A') {
            c[5] = c[5] + p.x;
            c[6] = c[6] + p.y;
          } else {
            for (var j = 0, jl = c.length; j < jl; ++j) {
              c[j] = c[j] + (j % 2 ? p.y : p.x);
            }
          }
          return pathHandlers[i](c, p, p0);
        };
      }(mlhvqtcsaz[i].toUpperCase());
    }

    extend(PathArray, {
      // Convert array to string
      toString: function toString() {
        return arrayToString(this);
      },
      // Move path string
      move: function move(x, y) {
        // get bounding box of current situation
        var box = this.bbox(); // get relative offset

        x -= box.x;
        y -= box.y;

        if (!isNaN(x) && !isNaN(y)) {
          // move every point
          for (var l, i = this.length - 1; i >= 0; i--) {
            l = this[i][0];

            if (l === 'M' || l === 'L' || l === 'T') {
              this[i][1] += x;
              this[i][2] += y;
            } else if (l === 'H') {
              this[i][1] += x;
            } else if (l === 'V') {
              this[i][1] += y;
            } else if (l === 'C' || l === 'S' || l === 'Q') {
              this[i][1] += x;
              this[i][2] += y;
              this[i][3] += x;
              this[i][4] += y;

              if (l === 'C') {
                this[i][5] += x;
                this[i][6] += y;
              }
            } else if (l === 'A') {
              this[i][6] += x;
              this[i][7] += y;
            }
          }
        }

        return this;
      },
      // Resize path string
      size: function size(width, height) {
        // get bounding box of current situation
        var box = this.bbox();
        var i, l; // If the box width or height is 0 then we ignore
        // transformations on the respective axis

        box.width = box.width === 0 ? 1 : box.width;
        box.height = box.height === 0 ? 1 : box.height; // recalculate position of all points according to new size

        for (i = this.length - 1; i >= 0; i--) {
          l = this[i][0];

          if (l === 'M' || l === 'L' || l === 'T') {
            this[i][1] = (this[i][1] - box.x) * width / box.width + box.x;
            this[i][2] = (this[i][2] - box.y) * height / box.height + box.y;
          } else if (l === 'H') {
            this[i][1] = (this[i][1] - box.x) * width / box.width + box.x;
          } else if (l === 'V') {
            this[i][1] = (this[i][1] - box.y) * height / box.height + box.y;
          } else if (l === 'C' || l === 'S' || l === 'Q') {
            this[i][1] = (this[i][1] - box.x) * width / box.width + box.x;
            this[i][2] = (this[i][2] - box.y) * height / box.height + box.y;
            this[i][3] = (this[i][3] - box.x) * width / box.width + box.x;
            this[i][4] = (this[i][4] - box.y) * height / box.height + box.y;

            if (l === 'C') {
              this[i][5] = (this[i][5] - box.x) * width / box.width + box.x;
              this[i][6] = (this[i][6] - box.y) * height / box.height + box.y;
            }
          } else if (l === 'A') {
            // resize radii
            this[i][1] = this[i][1] * width / box.width;
            this[i][2] = this[i][2] * height / box.height; // move position values

            this[i][6] = (this[i][6] - box.x) * width / box.width + box.x;
            this[i][7] = (this[i][7] - box.y) * height / box.height + box.y;
          }
        }

        return this;
      },
      // Test if the passed path array use the same path data commands as this path array
      equalCommands: function equalCommands(pathArray) {
        var i, il, equalCommands;
        pathArray = new PathArray(pathArray);
        equalCommands = this.length === pathArray.length;

        for (i = 0, il = this.length; equalCommands && i < il; i++) {
          equalCommands = this[i][0] === pathArray[i][0];
        }

        return equalCommands;
      },
      // Make path array morphable
      morph: function morph(pathArray) {
        pathArray = new PathArray(pathArray);

        if (this.equalCommands(pathArray)) {
          this.destination = pathArray;
        } else {
          this.destination = null;
        }

        return this;
      },
      // Get morphed path array at given position
      at: function at(pos) {
        // make sure a destination is defined
        if (!this.destination) return this;
        var sourceArray = this;
        var destinationArray = this.destination.value;
        var array = [];
        var pathArray = new PathArray();
        var i, il, j, jl; // Animate has specified in the SVG spec
        // See: https://www.w3.org/TR/SVG11/paths.html#PathElement

        for (i = 0, il = sourceArray.length; i < il; i++) {
          array[i] = [sourceArray[i][0]];

          for (j = 1, jl = sourceArray[i].length; j < jl; j++) {
            array[i][j] = sourceArray[i][j] + (destinationArray[i][j] - sourceArray[i][j]) * pos;
          } // For the two flags of the elliptical arc command, the SVG spec say:
          // Flags and booleans are interpolated as fractions between zero and one, with any non-zero value considered to be a value of one/true
          // Elliptical arc command as an array followed by corresponding indexes:
          // ['A', rx, ry, x-axis-rotation, large-arc-flag, sweep-flag, x, y]
          //   0    1   2        3                 4             5      6  7


          if (array[i][0] === 'A') {
            array[i][4] = +(array[i][4] !== 0);
            array[i][5] = +(array[i][5] !== 0);
          }
        } // Directly modify the value of a path array, this is done this way for performance


        pathArray.value = array;
        return pathArray;
      },
      // Absolutize and parse path to array
      parse: function parse() {
        var array = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [['M', 0, 0]];
        // if it's already a patharray, no need to parse it
        if (array instanceof PathArray) return array; // prepare for parsing

        var s;
        var paramCnt = {
          M: 2,
          L: 2,
          H: 1,
          V: 1,
          C: 6,
          S: 4,
          Q: 4,
          T: 2,
          A: 7,
          Z: 0
        };

        if (typeof array === 'string') {
          array = array.replace(numbersWithDots, pathRegReplace) // convert 45.123.123 to 45.123 .123
          .replace(pathLetters, ' $& ') // put some room between letters and numbers
          .replace(hyphen, '$1 -') // add space before hyphen
          .trim() // trim
          .split(delimiter); // split into array
        } else {
          array = array.reduce(function (prev, curr) {
            return [].concat.call(prev, curr);
          }, []);
        } // array now is an array containing all parts of a path e.g. ['M', '0', '0', 'L', '30', '30' ...]


        var result = [];
        var p = new Point();
        var p0 = new Point();
        var index = 0;
        var len = array.length;

        do {
          // Test if we have a path letter
          if (isPathLetter.test(array[index])) {
            s = array[index];
            ++index; // If last letter was a move command and we got no new, it defaults to [L]ine
          } else if (s === 'M') {
            s = 'L';
          } else if (s === 'm') {
            s = 'l';
          }

          result.push(pathHandlers[s].call(null, array.slice(index, index = index + paramCnt[s.toUpperCase()]).map(parseFloat), p, p0));
        } while (len > index);

        return result;
      },
      // Get bounding box of path
      bbox: function bbox() {
        parser().path.setAttribute('d', this.toString());
        return parser.nodes.path.getBBox();
      }
    });

    var Morphable =
    /*#__PURE__*/
    function () {
      function Morphable(stepper) {
        _classCallCheck(this, Morphable);

        this._stepper = stepper || new Ease('-');
        this._from = null;
        this._to = null;
        this._type = null;
        this._context = null;
        this._morphObj = null;
      }

      _createClass(Morphable, [{
        key: "from",
        value: function from(val) {
          if (val == null) {
            return this._from;
          }

          this._from = this._set(val);
          return this;
        }
      }, {
        key: "to",
        value: function to(val) {
          if (val == null) {
            return this._to;
          }

          this._to = this._set(val);
          return this;
        }
      }, {
        key: "type",
        value: function type(_type) {
          // getter
          if (_type == null) {
            return this._type;
          } // setter


          this._type = _type;
          return this;
        }
      }, {
        key: "_set",
        value: function _set(value) {
          if (!this._type) {
            var type = _typeof(value);

            if (type === 'number') {
              this.type(SVGNumber);
            } else if (type === 'string') {
              if (Color.isColor(value)) {
                this.type(Color);
              } else if (delimiter.test(value)) {
                this.type(pathLetters.test(value) ? PathArray : SVGArray);
              } else if (numberAndUnit.test(value)) {
                this.type(SVGNumber);
              } else {
                this.type(NonMorphable);
              }
            } else if (morphableTypes.indexOf(value.constructor) > -1) {
              this.type(value.constructor);
            } else if (Array.isArray(value)) {
              this.type(SVGArray);
            } else if (type === 'object') {
              this.type(ObjectBag);
            } else {
              this.type(NonMorphable);
            }
          }

          var result = new this._type(value);

          if (this._type === Color) {
            result = this._to ? result[this._to[4]]() : this._from ? result[this._from[4]]() : result;
          }

          result = result.toArray();
          this._morphObj = this._morphObj || new this._type();
          this._context = this._context || Array.apply(null, Array(result.length)).map(Object).map(function (o) {
            o.done = true;
            return o;
          });
          return result;
        }
      }, {
        key: "stepper",
        value: function stepper(_stepper) {
          if (_stepper == null) return this._stepper;
          this._stepper = _stepper;
          return this;
        }
      }, {
        key: "done",
        value: function done() {
          var complete = this._context.map(this._stepper.done).reduce(function (last, curr) {
            return last && curr;
          }, true);

          return complete;
        }
      }, {
        key: "at",
        value: function at(pos) {
          var _this = this;

          return this._morphObj.fromArray(this._from.map(function (i, index) {
            return _this._stepper.step(i, _this._to[index], pos, _this._context[index], _this._context);
          }));
        }
      }]);

      return Morphable;
    }();
    var NonMorphable =
    /*#__PURE__*/
    function () {
      function NonMorphable() {
        _classCallCheck(this, NonMorphable);

        this.init.apply(this, arguments);
      }

      _createClass(NonMorphable, [{
        key: "init",
        value: function init(val) {
          val = Array.isArray(val) ? val[0] : val;
          this.value = val;
          return this;
        }
      }, {
        key: "valueOf",
        value: function valueOf() {
          return this.value;
        }
      }, {
        key: "toArray",
        value: function toArray() {
          return [this.value];
        }
      }]);

      return NonMorphable;
    }();
    var TransformBag =
    /*#__PURE__*/
    function () {
      function TransformBag() {
        _classCallCheck(this, TransformBag);

        this.init.apply(this, arguments);
      }

      _createClass(TransformBag, [{
        key: "init",
        value: function init(obj) {
          if (Array.isArray(obj)) {
            obj = {
              scaleX: obj[0],
              scaleY: obj[1],
              shear: obj[2],
              rotate: obj[3],
              translateX: obj[4],
              translateY: obj[5],
              originX: obj[6],
              originY: obj[7]
            };
          }

          Object.assign(this, TransformBag.defaults, obj);
          return this;
        }
      }, {
        key: "toArray",
        value: function toArray() {
          var v = this;
          return [v.scaleX, v.scaleY, v.shear, v.rotate, v.translateX, v.translateY, v.originX, v.originY];
        }
      }]);

      return TransformBag;
    }();
    TransformBag.defaults = {
      scaleX: 1,
      scaleY: 1,
      shear: 0,
      rotate: 0,
      translateX: 0,
      translateY: 0,
      originX: 0,
      originY: 0
    };
    var ObjectBag =
    /*#__PURE__*/
    function () {
      function ObjectBag() {
        _classCallCheck(this, ObjectBag);

        this.init.apply(this, arguments);
      }

      _createClass(ObjectBag, [{
        key: "init",
        value: function init(objOrArr) {
          this.values = [];

          if (Array.isArray(objOrArr)) {
            this.values = objOrArr;
            return;
          }

          objOrArr = objOrArr || {};
          var entries = [];

          for (var i in objOrArr) {
            entries.push([i, objOrArr[i]]);
          }

          entries.sort(function (a, b) {
            return a[0] - b[0];
          });
          this.values = entries.reduce(function (last, curr) {
            return last.concat(curr);
          }, []);
          return this;
        }
      }, {
        key: "valueOf",
        value: function valueOf() {
          var obj = {};
          var arr = this.values;

          for (var i = 0, len = arr.length; i < len; i += 2) {
            obj[arr[i]] = arr[i + 1];
          }

          return obj;
        }
      }, {
        key: "toArray",
        value: function toArray() {
          return this.values;
        }
      }]);

      return ObjectBag;
    }();
    var morphableTypes = [NonMorphable, TransformBag, ObjectBag];
    function registerMorphableType() {
      var type = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
      morphableTypes.push.apply(morphableTypes, _toConsumableArray([].concat(type)));
    }
    function makeMorphable() {
      extend(morphableTypes, {
        to: function to(val) {
          return new Morphable().type(this.constructor).from(this.valueOf()).to(val);
        },
        fromArray: function fromArray(arr) {
          this.init(arr);
          return this;
        }
      });
    }

    var Path =
    /*#__PURE__*/
    function (_Shape) {
      _inherits(Path, _Shape);

      // Initialize node
      function Path(node) {
        _classCallCheck(this, Path);

        return _possibleConstructorReturn(this, _getPrototypeOf(Path).call(this, nodeOrNew('path', node), node));
      } // Get array


      _createClass(Path, [{
        key: "array",
        value: function array() {
          return this._array || (this._array = new PathArray(this.attr('d')));
        } // Plot new path

      }, {
        key: "plot",
        value: function plot(d) {
          return d == null ? this.array() : this.clear().attr('d', typeof d === 'string' ? d : this._array = new PathArray(d));
        } // Clear array cache

      }, {
        key: "clear",
        value: function clear() {
          delete this._array;
          return this;
        } // Move by left top corner

      }, {
        key: "move",
        value: function move(x, y) {
          return this.attr('d', this.array().move(x, y));
        } // Move by left top corner over x-axis

      }, {
        key: "x",
        value: function x(_x) {
          return _x == null ? this.bbox().x : this.move(_x, this.bbox().y);
        } // Move by left top corner over y-axis

      }, {
        key: "y",
        value: function y(_y) {
          return _y == null ? this.bbox().y : this.move(this.bbox().x, _y);
        } // Set element size to given width and height

      }, {
        key: "size",
        value: function size(width, height) {
          var p = proportionalSize(this, width, height);
          return this.attr('d', this.array().size(p.width, p.height));
        } // Set width of element

      }, {
        key: "width",
        value: function width(_width) {
          return _width == null ? this.bbox().width : this.size(_width, this.bbox().height);
        } // Set height of element

      }, {
        key: "height",
        value: function height(_height) {
          return _height == null ? this.bbox().height : this.size(this.bbox().width, _height);
        }
      }, {
        key: "targets",
        value: function targets() {
          return baseFind('svg textpath [href*="' + this.id() + '"]');
        }
      }]);

      return Path;
    }(Shape); // Define morphable array
    Path.prototype.MorphArray = PathArray; // Add parent method

    registerMethods({
      Container: {
        // Create a wrapped path element
        path: wrapWithAttrCheck(function (d) {
          // make sure plot is called as a setter
          return this.put(new Path()).plot(d || new PathArray());
        })
      }
    });
    register(Path, 'Path');

    function array() {
      return this._array || (this._array = new PointArray(this.attr('points')));
    } // Plot new path

    function plot(p) {
      return p == null ? this.array() : this.clear().attr('points', typeof p === 'string' ? p : this._array = new PointArray(p));
    } // Clear array cache

    function clear() {
      delete this._array;
      return this;
    } // Move by left top corner

    function move(x, y) {
      return this.attr('points', this.array().move(x, y));
    } // Set element size to given width and height

    function size(width, height) {
      var p = proportionalSize(this, width, height);
      return this.attr('points', this.array().size(p.width, p.height));
    }

    var poly = ({
    	__proto__: null,
    	array: array,
    	plot: plot,
    	clear: clear,
    	move: move,
    	size: size
    });

    var Polygon =
    /*#__PURE__*/
    function (_Shape) {
      _inherits(Polygon, _Shape);

      // Initialize node
      function Polygon(node) {
        _classCallCheck(this, Polygon);

        return _possibleConstructorReturn(this, _getPrototypeOf(Polygon).call(this, nodeOrNew('polygon', node), node));
      }

      return Polygon;
    }(Shape);
    registerMethods({
      Container: {
        // Create a wrapped polygon element
        polygon: wrapWithAttrCheck(function (p) {
          // make sure plot is called as a setter
          return this.put(new Polygon()).plot(p || new PointArray());
        })
      }
    });
    extend(Polygon, pointed);
    extend(Polygon, poly);
    register(Polygon, 'Polygon');

    var Polyline =
    /*#__PURE__*/
    function (_Shape) {
      _inherits(Polyline, _Shape);

      // Initialize node
      function Polyline(node) {
        _classCallCheck(this, Polyline);

        return _possibleConstructorReturn(this, _getPrototypeOf(Polyline).call(this, nodeOrNew('polyline', node), node));
      }

      return Polyline;
    }(Shape);
    registerMethods({
      Container: {
        // Create a wrapped polygon element
        polyline: wrapWithAttrCheck(function (p) {
          // make sure plot is called as a setter
          return this.put(new Polyline()).plot(p || new PointArray());
        })
      }
    });
    extend(Polyline, pointed);
    extend(Polyline, poly);
    register(Polyline, 'Polyline');

    var Rect =
    /*#__PURE__*/
    function (_Shape) {
      _inherits(Rect, _Shape);

      // Initialize node
      function Rect(node) {
        _classCallCheck(this, Rect);

        return _possibleConstructorReturn(this, _getPrototypeOf(Rect).call(this, nodeOrNew('rect', node), node));
      }

      return Rect;
    }(Shape);
    extend(Rect, {
      rx: rx,
      ry: ry
    });
    registerMethods({
      Container: {
        // Create a rect element
        rect: wrapWithAttrCheck(function (width, height) {
          return this.put(new Rect()).size(width, height);
        })
      }
    });
    register(Rect, 'Rect');

    var max$3 = Math.max;
    var min$4 = Math.min;
    var MAX_SAFE_INTEGER$1 = 0x1FFFFFFFFFFFFF;
    var MAXIMUM_ALLOWED_LENGTH_EXCEEDED = 'Maximum allowed length exceeded';

    // `Array.prototype.splice` method
    // https://tc39.github.io/ecma262/#sec-array.prototype.splice
    // with adding support of @@species
    _export({ target: 'Array', proto: true, forced: !arrayMethodHasSpeciesSupport('splice') }, {
      splice: function splice(start, deleteCount /* , ...items */) {
        var O = toObject(this);
        var len = toLength(O.length);
        var actualStart = toAbsoluteIndex(start, len);
        var argumentsLength = arguments.length;
        var insertCount, actualDeleteCount, A, k, from, to;
        if (argumentsLength === 0) {
          insertCount = actualDeleteCount = 0;
        } else if (argumentsLength === 1) {
          insertCount = 0;
          actualDeleteCount = len - actualStart;
        } else {
          insertCount = argumentsLength - 2;
          actualDeleteCount = min$4(max$3(toInteger(deleteCount), 0), len - actualStart);
        }
        if (len + insertCount - actualDeleteCount > MAX_SAFE_INTEGER$1) {
          throw TypeError(MAXIMUM_ALLOWED_LENGTH_EXCEEDED);
        }
        A = arraySpeciesCreate(O, actualDeleteCount);
        for (k = 0; k < actualDeleteCount; k++) {
          from = actualStart + k;
          if (from in O) createProperty(A, k, O[from]);
        }
        A.length = actualDeleteCount;
        if (insertCount < actualDeleteCount) {
          for (k = actualStart; k < len - actualDeleteCount; k++) {
            from = k + actualDeleteCount;
            to = k + insertCount;
            if (from in O) O[to] = O[from];
            else delete O[to];
          }
          for (k = len; k > len - actualDeleteCount + insertCount; k--) delete O[k - 1];
        } else if (insertCount > actualDeleteCount) {
          for (k = len - actualDeleteCount; k > actualStart; k--) {
            from = k + actualDeleteCount - 1;
            to = k + insertCount - 1;
            if (from in O) O[to] = O[from];
            else delete O[to];
          }
        }
        for (k = 0; k < insertCount; k++) {
          O[k + actualStart] = arguments[k + 2];
        }
        O.length = len - actualDeleteCount + insertCount;
        return A;
      }
    });

    var Queue =
    /*#__PURE__*/
    function () {
      function Queue() {
        _classCallCheck(this, Queue);

        this._first = null;
        this._last = null;
      }

      _createClass(Queue, [{
        key: "push",
        value: function push(value) {
          // An item stores an id and the provided value
          var item = value.next ? value : {
            value: value,
            next: null,
            prev: null
          }; // Deal with the queue being empty or populated

          if (this._last) {
            item.prev = this._last;
            this._last.next = item;
            this._last = item;
          } else {
            this._last = item;
            this._first = item;
          } // Return the current item


          return item;
        }
      }, {
        key: "shift",
        value: function shift() {
          // Check if we have a value
          var remove = this._first;
          if (!remove) return null; // If we do, remove it and relink things

          this._first = remove.next;
          if (this._first) this._first.prev = null;
          this._last = this._first ? this._last : null;
          return remove.value;
        } // Shows us the first item in the list

      }, {
        key: "first",
        value: function first() {
          return this._first && this._first.value;
        } // Shows us the last item in the list

      }, {
        key: "last",
        value: function last() {
          return this._last && this._last.value;
        } // Removes the item that was returned from the push

      }, {
        key: "remove",
        value: function remove(item) {
          // Relink the previous item
          if (item.prev) item.prev.next = item.next;
          if (item.next) item.next.prev = item.prev;
          if (item === this._last) this._last = item.prev;
          if (item === this._first) this._first = item.next; // Invalidate item

          item.prev = null;
          item.next = null;
        }
      }]);

      return Queue;
    }();

    var Animator = {
      nextDraw: null,
      frames: new Queue(),
      timeouts: new Queue(),
      immediates: new Queue(),
      timer: function timer() {
        return globals$1.window.performance || globals$1.window.Date;
      },
      transforms: [],
      frame: function frame(fn) {
        // Store the node
        var node = Animator.frames.push({
          run: fn
        }); // Request an animation frame if we don't have one

        if (Animator.nextDraw === null) {
          Animator.nextDraw = globals$1.window.requestAnimationFrame(Animator._draw);
        } // Return the node so we can remove it easily


        return node;
      },
      timeout: function timeout(fn, delay) {
        delay = delay || 0; // Work out when the event should fire

        var time = Animator.timer().now() + delay; // Add the timeout to the end of the queue

        var node = Animator.timeouts.push({
          run: fn,
          time: time
        }); // Request another animation frame if we need one

        if (Animator.nextDraw === null) {
          Animator.nextDraw = globals$1.window.requestAnimationFrame(Animator._draw);
        }

        return node;
      },
      immediate: function immediate(fn) {
        // Add the immediate fn to the end of the queue
        var node = Animator.immediates.push(fn); // Request another animation frame if we need one

        if (Animator.nextDraw === null) {
          Animator.nextDraw = globals$1.window.requestAnimationFrame(Animator._draw);
        }

        return node;
      },
      cancelFrame: function cancelFrame(node) {
        node != null && Animator.frames.remove(node);
      },
      clearTimeout: function clearTimeout(node) {
        node != null && Animator.timeouts.remove(node);
      },
      cancelImmediate: function cancelImmediate(node) {
        node != null && Animator.immediates.remove(node);
      },
      _draw: function _draw(now) {
        // Run all the timeouts we can run, if they are not ready yet, add them
        // to the end of the queue immediately! (bad timeouts!!! [sarcasm])
        var nextTimeout = null;
        var lastTimeout = Animator.timeouts.last();

        while (nextTimeout = Animator.timeouts.shift()) {
          // Run the timeout if its time, or push it to the end
          if (now >= nextTimeout.time) {
            nextTimeout.run();
          } else {
            Animator.timeouts.push(nextTimeout);
          } // If we hit the last item, we should stop shifting out more items


          if (nextTimeout === lastTimeout) break;
        } // Run all of the animation frames


        var nextFrame = null;
        var lastFrame = Animator.frames.last();

        while (nextFrame !== lastFrame && (nextFrame = Animator.frames.shift())) {
          nextFrame.run(now);
        }

        var nextImmediate = null;

        while (nextImmediate = Animator.immediates.shift()) {
          nextImmediate();
        } // If we have remaining timeouts or frames, draw until we don't anymore


        Animator.nextDraw = Animator.timeouts.first() || Animator.frames.first() ? globals$1.window.requestAnimationFrame(Animator._draw) : null;
      }
    };

    var makeSchedule = function makeSchedule(runnerInfo) {
      var start = runnerInfo.start;
      var duration = runnerInfo.runner.duration();
      var end = start + duration;
      return {
        start: start,
        duration: duration,
        end: end,
        runner: runnerInfo.runner
      };
    };

    var defaultSource = function defaultSource() {
      var w = globals$1.window;
      return (w.performance || w.Date).now();
    };

    var Timeline =
    /*#__PURE__*/
    function (_EventTarget) {
      _inherits(Timeline, _EventTarget);

      // Construct a new timeline on the given element
      function Timeline() {
        var _this;

        var timeSource = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : defaultSource;

        _classCallCheck(this, Timeline);

        _this = _possibleConstructorReturn(this, _getPrototypeOf(Timeline).call(this));
        _this._timeSource = timeSource; // Store the timing variables

        _this._startTime = 0;
        _this._speed = 1.0; // Determines how long a runner is hold in memory. Can be a dt or true/false

        _this._persist = 0; // Keep track of the running animations and their starting parameters

        _this._nextFrame = null;
        _this._paused = true;
        _this._runners = [];
        _this._runnerIds = [];
        _this._lastRunnerId = -1;
        _this._time = 0;
        _this._lastSourceTime = 0;
        _this._lastStepTime = 0; // Make sure that step is always called in class context

        _this._step = _this._stepFn.bind(_assertThisInitialized(_this), false);
        _this._stepImmediate = _this._stepFn.bind(_assertThisInitialized(_this), true);
        return _this;
      } // schedules a runner on the timeline


      _createClass(Timeline, [{
        key: "schedule",
        value: function schedule(runner, delay, when) {
          if (runner == null) {
            return this._runners.map(makeSchedule);
          } // The start time for the next animation can either be given explicitly,
          // derived from the current timeline time or it can be relative to the
          // last start time to chain animations direclty


          var absoluteStartTime = 0;
          var endTime = this.getEndTime();
          delay = delay || 0; // Work out when to start the animation

          if (when == null || when === 'last' || when === 'after') {
            // Take the last time and increment
            absoluteStartTime = endTime;
          } else if (when === 'absolute' || when === 'start') {
            absoluteStartTime = delay;
            delay = 0;
          } else if (when === 'now') {
            absoluteStartTime = this._time;
          } else if (when === 'relative') {
            var _runnerInfo = this._runners[runner.id];

            if (_runnerInfo) {
              absoluteStartTime = _runnerInfo.start + delay;
              delay = 0;
            }
          } else {
            throw new Error('Invalid value for the "when" parameter');
          } // Manage runner


          runner.unschedule();
          runner.timeline(this);
          var persist = runner.persist();
          var runnerInfo = {
            persist: persist === null ? this._persist : persist,
            start: absoluteStartTime + delay,
            runner: runner
          };
          this._lastRunnerId = runner.id;

          this._runners.push(runnerInfo);

          this._runners.sort(function (a, b) {
            return a.start - b.start;
          });

          this._runnerIds = this._runners.map(function (info) {
            return info.runner.id;
          });

          this.updateTime()._continue();

          return this;
        } // Remove the runner from this timeline

      }, {
        key: "unschedule",
        value: function unschedule(runner) {
          var index = this._runnerIds.indexOf(runner.id);

          if (index < 0) return this;

          this._runners.splice(index, 1);

          this._runnerIds.splice(index, 1);

          runner.timeline(null);
          return this;
        } // Calculates the end of the timeline

      }, {
        key: "getEndTime",
        value: function getEndTime() {
          var lastRunnerInfo = this._runners[this._runnerIds.indexOf(this._lastRunnerId)];

          var lastDuration = lastRunnerInfo ? lastRunnerInfo.runner.duration() : 0;
          var lastStartTime = lastRunnerInfo ? lastRunnerInfo.start : 0;
          return lastStartTime + lastDuration;
        }
      }, {
        key: "getEndTimeOfTimeline",
        value: function getEndTimeOfTimeline() {
          var lastEndTime = 0;

          for (var i = 0; i < this._runners.length; i++) {
            var runnerInfo = this._runners[i];
            var duration = runnerInfo ? runnerInfo.runner.duration() : 0;
            var startTime = runnerInfo ? runnerInfo.start : 0;
            var endTime = startTime + duration;

            if (endTime > lastEndTime) {
              lastEndTime = endTime;
            }
          }

          return lastEndTime;
        } // Makes sure, that after pausing the time doesn't jump

      }, {
        key: "updateTime",
        value: function updateTime() {
          if (!this.active()) {
            this._lastSourceTime = this._timeSource();
          }

          return this;
        }
      }, {
        key: "play",
        value: function play() {
          // Now make sure we are not paused and continue the animation
          this._paused = false;
          return this.updateTime()._continue();
        }
      }, {
        key: "pause",
        value: function pause() {
          this._paused = true;
          return this._continue();
        }
      }, {
        key: "stop",
        value: function stop() {
          // Go to start and pause
          this.time(0);
          return this.pause();
        }
      }, {
        key: "finish",
        value: function finish() {
          // Go to end and pause
          this.time(this.getEndTimeOfTimeline() + 1);
          return this.pause();
        }
      }, {
        key: "speed",
        value: function speed(_speed) {
          if (_speed == null) return this._speed;
          this._speed = _speed;
          return this;
        }
      }, {
        key: "reverse",
        value: function reverse(yes) {
          var currentSpeed = this.speed();
          if (yes == null) return this.speed(-currentSpeed);
          var positive = Math.abs(currentSpeed);
          return this.speed(yes ? positive : -positive);
        }
      }, {
        key: "seek",
        value: function seek(dt) {
          return this.time(this._time + dt);
        }
      }, {
        key: "time",
        value: function time(_time) {
          if (_time == null) return this._time;
          this._time = _time;
          return this._continue(true);
        }
      }, {
        key: "persist",
        value: function persist(dtOrForever) {
          if (dtOrForever == null) return this._persist;
          this._persist = dtOrForever;
          return this;
        }
      }, {
        key: "source",
        value: function source(fn) {
          if (fn == null) return this._timeSource;
          this._timeSource = fn;
          return this;
        }
      }, {
        key: "_stepFn",
        value: function _stepFn() {
          var immediateStep = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;

          // Get the time delta from the last time and update the time
          var time = this._timeSource();

          var dtSource = time - this._lastSourceTime;
          if (immediateStep) dtSource = 0;
          var dtTime = this._speed * dtSource + (this._time - this._lastStepTime);
          this._lastSourceTime = time; // Only update the time if we use the timeSource.
          // Otherwise use the current time

          if (!immediateStep) {
            // Update the time
            this._time += dtTime;
            this._time = this._time < 0 ? 0 : this._time;
          }

          this._lastStepTime = this._time;
          this.fire('time', this._time); // This is for the case that the timeline was seeked so that the time
          // is now before the startTime of the runner. Thats why we need to set
          // the runner to position 0
          // FIXME:
          // However, reseting in insertion order leads to bugs. Considering the case,
          // where 2 runners change the same attriute but in different times,
          // reseting both of them will lead to the case where the later defined
          // runner always wins the reset even if the other runner started earlier
          // and therefore should win the attribute battle
          // this can be solved by reseting them backwards

          for (var k = this._runners.length; k--;) {
            // Get and run the current runner and ignore it if its inactive
            var runnerInfo = this._runners[k];
            var runner = runnerInfo.runner; // Make sure that we give the actual difference
            // between runner start time and now

            var dtToStart = this._time - runnerInfo.start; // Dont run runner if not started yet
            // and try to reset it

            if (dtToStart <= 0) {
              runner.reset();
            }
          } // Run all of the runners directly


          var runnersLeft = false;

          for (var i = 0, len = this._runners.length; i < len; i++) {
            // Get and run the current runner and ignore it if its inactive
            var _runnerInfo2 = this._runners[i];
            var _runner = _runnerInfo2.runner;
            var dt = dtTime; // Make sure that we give the actual difference
            // between runner start time and now

            var _dtToStart = this._time - _runnerInfo2.start; // Dont run runner if not started yet


            if (_dtToStart <= 0) {
              runnersLeft = true;
              continue;
            } else if (_dtToStart < dt) {
              // Adjust dt to make sure that animation is on point
              dt = _dtToStart;
            }

            if (!_runner.active()) continue; // If this runner is still going, signal that we need another animation
            // frame, otherwise, remove the completed runner

            var finished = _runner.step(dt).done;

            if (!finished) {
              runnersLeft = true; // continue
            } else if (_runnerInfo2.persist !== true) {
              // runner is finished. And runner might get removed
              var endTime = _runner.duration() - _runner.time() + this._time;

              if (endTime + _runnerInfo2.persist < this._time) {
                // Delete runner and correct index
                _runner.unschedule();

                --i;
                --len;
              }
            }
          } // Basically: we continue when there are runners right from us in time
          // when -->, and when runners are left from us when <--


          if (runnersLeft && !(this._speed < 0 && this._time === 0) || this._runnerIds.length && this._speed < 0 && this._time > 0) {
            this._continue();
          } else {
            this.pause();
            this.fire('finished');
          }

          return this;
        } // Checks if we are running and continues the animation

      }, {
        key: "_continue",
        value: function _continue() {
          var immediateStep = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
          Animator.cancelFrame(this._nextFrame);
          this._nextFrame = null;
          if (immediateStep) return this._stepImmediate();
          if (this._paused) return this;
          this._nextFrame = Animator.frame(this._step);
          return this;
        }
      }, {
        key: "active",
        value: function active() {
          return !!this._nextFrame;
        }
      }]);

      return Timeline;
    }(EventTarget);
    registerMethods({
      Element: {
        timeline: function timeline(_timeline) {
          if (_timeline == null) {
            this._timeline = this._timeline || new Timeline();
            return this._timeline;
          } else {
            this._timeline = _timeline;
            return this;
          }
        }
      }
    });

    function ownKeys$2(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

    function _objectSpread$1(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys$2(source, true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys$2(source).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

    var Runner =
    /*#__PURE__*/
    function (_EventTarget) {
      _inherits(Runner, _EventTarget);

      function Runner(options) {
        var _this;

        _classCallCheck(this, Runner);

        _this = _possibleConstructorReturn(this, _getPrototypeOf(Runner).call(this)); // Store a unique id on the runner, so that we can identify it later

        _this.id = Runner.id++; // Ensure a default value

        options = options == null ? timeline.duration : options; // Ensure that we get a controller

        options = typeof options === 'function' ? new Controller(options) : options; // Declare all of the variables

        _this._element = null;
        _this._timeline = null;
        _this.done = false;
        _this._queue = []; // Work out the stepper and the duration

        _this._duration = typeof options === 'number' && options;
        _this._isDeclarative = options instanceof Controller;
        _this._stepper = _this._isDeclarative ? options : new Ease(); // We copy the current values from the timeline because they can change

        _this._history = {}; // Store the state of the runner

        _this.enabled = true;
        _this._time = 0;
        _this._lastTime = 0; // At creation, the runner is in reseted state

        _this._reseted = true; // Save transforms applied to this runner

        _this.transforms = new Matrix();
        _this.transformId = 1; // Looping variables

        _this._haveReversed = false;
        _this._reverse = false;
        _this._loopsDone = 0;
        _this._swing = false;
        _this._wait = 0;
        _this._times = 1;
        _this._frameId = null; // Stores how long a runner is stored after beeing done

        _this._persist = _this._isDeclarative ? true : null;
        return _this;
      }
      /*
      Runner Definitions
      ==================
      These methods help us define the runtime behaviour of the Runner or they
      help us make new runners from the current runner
      */


      _createClass(Runner, [{
        key: "element",
        value: function element(_element) {
          if (_element == null) return this._element;
          this._element = _element;

          _element._prepareRunner();

          return this;
        }
      }, {
        key: "timeline",
        value: function timeline(_timeline) {
          // check explicitly for undefined so we can set the timeline to null
          if (typeof _timeline === 'undefined') return this._timeline;
          this._timeline = _timeline;
          return this;
        }
      }, {
        key: "animate",
        value: function animate(duration, delay, when) {
          var o = Runner.sanitise(duration, delay, when);
          var runner = new Runner(o.duration);
          if (this._timeline) runner.timeline(this._timeline);
          if (this._element) runner.element(this._element);
          return runner.loop(o).schedule(o.delay, o.when);
        }
      }, {
        key: "schedule",
        value: function schedule(timeline, delay, when) {
          // The user doesn't need to pass a timeline if we already have one
          if (!(timeline instanceof Timeline)) {
            when = delay;
            delay = timeline;
            timeline = this.timeline();
          } // If there is no timeline, yell at the user...


          if (!timeline) {
            throw Error('Runner cannot be scheduled without timeline');
          } // Schedule the runner on the timeline provided


          timeline.schedule(this, delay, when);
          return this;
        }
      }, {
        key: "unschedule",
        value: function unschedule() {
          var timeline = this.timeline();
          timeline && timeline.unschedule(this);
          return this;
        }
      }, {
        key: "loop",
        value: function loop(times, swing, wait) {
          // Deal with the user passing in an object
          if (_typeof(times) === 'object') {
            swing = times.swing;
            wait = times.wait;
            times = times.times;
          } // Sanitise the values and store them


          this._times = times || Infinity;
          this._swing = swing || false;
          this._wait = wait || 0; // Allow true to be passed

          if (this._times === true) {
            this._times = Infinity;
          }

          return this;
        }
      }, {
        key: "delay",
        value: function delay(_delay) {
          return this.animate(0, _delay);
        }
        /*
        Basic Functionality
        ===================
        These methods allow us to attach basic functions to the runner directly
        */

      }, {
        key: "queue",
        value: function queue(initFn, runFn, retargetFn, isTransform) {
          this._queue.push({
            initialiser: initFn || noop$1,
            runner: runFn || noop$1,
            retarget: retargetFn,
            isTransform: isTransform,
            initialised: false,
            finished: false
          });

          var timeline = this.timeline();
          timeline && this.timeline()._continue();
          return this;
        }
      }, {
        key: "during",
        value: function during(fn) {
          return this.queue(null, fn);
        }
      }, {
        key: "after",
        value: function after(fn) {
          return this.on('finished', fn);
        }
        /*
        Runner animation methods
        ========================
        Control how the animation plays
        */

      }, {
        key: "time",
        value: function time(_time) {
          if (_time == null) {
            return this._time;
          }

          var dt = _time - this._time;
          this.step(dt);
          return this;
        }
      }, {
        key: "duration",
        value: function duration() {
          return this._times * (this._wait + this._duration) - this._wait;
        }
      }, {
        key: "loops",
        value: function loops(p) {
          var loopDuration = this._duration + this._wait;

          if (p == null) {
            var loopsDone = Math.floor(this._time / loopDuration);
            var relativeTime = this._time - loopsDone * loopDuration;
            var position = relativeTime / this._duration;
            return Math.min(loopsDone + position, this._times);
          }

          var whole = Math.floor(p);
          var partial = p % 1;
          var time = loopDuration * whole + this._duration * partial;
          return this.time(time);
        }
      }, {
        key: "persist",
        value: function persist(dtOrForever) {
          if (dtOrForever == null) return this._persist;
          this._persist = dtOrForever;
          return this;
        }
      }, {
        key: "position",
        value: function position(p) {
          // Get all of the variables we need
          var x = this._time;
          var d = this._duration;
          var w = this._wait;
          var t = this._times;
          var s = this._swing;
          var r = this._reverse;
          var position;

          if (p == null) {
            /*
            This function converts a time to a position in the range [0, 1]
            The full explanation can be found in this desmos demonstration
              https://www.desmos.com/calculator/u4fbavgche
            The logic is slightly simplified here because we can use booleans
            */
            // Figure out the value without thinking about the start or end time
            var f = function f(x) {
              var swinging = s * Math.floor(x % (2 * (w + d)) / (w + d));
              var backwards = swinging && !r || !swinging && r;
              var uncliped = Math.pow(-1, backwards) * (x % (w + d)) / d + backwards;
              var clipped = Math.max(Math.min(uncliped, 1), 0);
              return clipped;
            }; // Figure out the value by incorporating the start time


            var endTime = t * (w + d) - w;
            position = x <= 0 ? Math.round(f(1e-5)) : x < endTime ? f(x) : Math.round(f(endTime - 1e-5));
            return position;
          } // Work out the loops done and add the position to the loops done


          var loopsDone = Math.floor(this.loops());
          var swingForward = s && loopsDone % 2 === 0;
          var forwards = swingForward && !r || r && swingForward;
          position = loopsDone + (forwards ? p : 1 - p);
          return this.loops(position);
        }
      }, {
        key: "progress",
        value: function progress(p) {
          if (p == null) {
            return Math.min(1, this._time / this.duration());
          }

          return this.time(p * this.duration());
        }
      }, {
        key: "step",
        value: function step(dt) {
          // If we are inactive, this stepper just gets skipped
          if (!this.enabled) return this; // Update the time and get the new position

          dt = dt == null ? 16 : dt;
          this._time += dt;
          var position = this.position(); // Figure out if we need to run the stepper in this frame

          var running = this._lastPosition !== position && this._time >= 0;
          this._lastPosition = position; // Figure out if we just started

          var duration = this.duration();
          var justStarted = this._lastTime <= 0 && this._time > 0;
          var justFinished = this._lastTime < duration && this._time >= duration;
          this._lastTime = this._time;

          if (justStarted) {
            this.fire('start', this);
          } // Work out if the runner is finished set the done flag here so animations
          // know, that they are running in the last step (this is good for
          // transformations which can be merged)


          var declarative = this._isDeclarative;
          this.done = !declarative && !justFinished && this._time >= duration; // Runner is running. So its not in reseted state anymore

          this._reseted = false; // Call initialise and the run function

          if (running || declarative) {
            this._initialise(running); // clear the transforms on this runner so they dont get added again and again


            this.transforms = new Matrix();

            var converged = this._run(declarative ? dt : position);

            this.fire('step', this);
          } // correct the done flag here
          // declaritive animations itself know when they converged


          this.done = this.done || converged && declarative;

          if (justFinished) {
            this.fire('finished', this);
          }

          return this;
        }
      }, {
        key: "reset",
        value: function reset() {
          if (this._reseted) return this;
          this.time(0);
          this._reseted = true;
          return this;
        }
      }, {
        key: "finish",
        value: function finish() {
          return this.step(Infinity);
        }
      }, {
        key: "reverse",
        value: function reverse(_reverse) {
          this._reverse = _reverse == null ? !this._reverse : _reverse;
          return this;
        }
      }, {
        key: "ease",
        value: function ease(fn) {
          this._stepper = new Ease(fn);
          return this;
        }
      }, {
        key: "active",
        value: function active(enabled) {
          if (enabled == null) return this.enabled;
          this.enabled = enabled;
          return this;
        }
        /*
        Private Methods
        ===============
        Methods that shouldn't be used externally
        */
        // Save a morpher to the morpher list so that we can retarget it later

      }, {
        key: "_rememberMorpher",
        value: function _rememberMorpher(method, morpher) {
          this._history[method] = {
            morpher: morpher,
            caller: this._queue[this._queue.length - 1]
          }; // We have to resume the timeline in case a controller
          // is already done without beeing ever run
          // This can happen when e.g. this is done:
          //    anim = el.animate(new SVG.Spring)
          // and later
          //    anim.move(...)

          if (this._isDeclarative) {
            var timeline = this.timeline();
            timeline && timeline.play();
          }
        } // Try to set the target for a morpher if the morpher exists, otherwise
        // do nothing and return false

      }, {
        key: "_tryRetarget",
        value: function _tryRetarget(method, target, extra) {
          if (this._history[method]) {
            // if the last method wasnt even initialised, throw it away
            if (!this._history[method].caller.initialised) {
              var index = this._queue.indexOf(this._history[method].caller);

              this._queue.splice(index, 1);

              return false;
            } // for the case of transformations, we use the special retarget function
            // which has access to the outer scope


            if (this._history[method].caller.retarget) {
              this._history[method].caller.retarget(target, extra); // for everything else a simple morpher change is sufficient

            } else {
              this._history[method].morpher.to(target);
            }

            this._history[method].caller.finished = false;
            var timeline = this.timeline();
            timeline && timeline.play();
            return true;
          }

          return false;
        } // Run each initialise function in the runner if required

      }, {
        key: "_initialise",
        value: function _initialise(running) {
          // If we aren't running, we shouldn't initialise when not declarative
          if (!running && !this._isDeclarative) return; // Loop through all of the initialisers

          for (var i = 0, len = this._queue.length; i < len; ++i) {
            // Get the current initialiser
            var current = this._queue[i]; // Determine whether we need to initialise

            var needsIt = this._isDeclarative || !current.initialised && running;
            running = !current.finished; // Call the initialiser if we need to

            if (needsIt && running) {
              current.initialiser.call(this);
              current.initialised = true;
            }
          }
        } // Run each run function for the position or dt given

      }, {
        key: "_run",
        value: function _run(positionOrDt) {
          // Run all of the _queue directly
          var allfinished = true;

          for (var i = 0, len = this._queue.length; i < len; ++i) {
            // Get the current function to run
            var current = this._queue[i]; // Run the function if its not finished, we keep track of the finished
            // flag for the sake of declarative _queue

            var converged = current.runner.call(this, positionOrDt);
            current.finished = current.finished || converged === true;
            allfinished = allfinished && current.finished;
          } // We report when all of the constructors are finished


          return allfinished;
        }
      }, {
        key: "addTransform",
        value: function addTransform(transform, index) {
          this.transforms.lmultiplyO(transform);
          return this;
        }
      }, {
        key: "clearTransform",
        value: function clearTransform() {
          this.transforms = new Matrix();
          return this;
        } // TODO: Keep track of all transformations so that deletion is faster

      }, {
        key: "clearTransformsFromQueue",
        value: function clearTransformsFromQueue() {
          if (!this.done || !this._timeline || !this._timeline._runnerIds.includes(this.id)) {
            this._queue = this._queue.filter(function (item) {
              return !item.isTransform;
            });
          }
        }
      }], [{
        key: "sanitise",
        value: function sanitise(duration, delay, when) {
          // Initialise the default parameters
          var times = 1;
          var swing = false;
          var wait = 0;
          duration = duration || timeline.duration;
          delay = delay || timeline.delay;
          when = when || 'last'; // If we have an object, unpack the values

          if (_typeof(duration) === 'object' && !(duration instanceof Stepper)) {
            delay = duration.delay || delay;
            when = duration.when || when;
            swing = duration.swing || swing;
            times = duration.times || times;
            wait = duration.wait || wait;
            duration = duration.duration || timeline.duration;
          }

          return {
            duration: duration,
            delay: delay,
            swing: swing,
            times: times,
            wait: wait,
            when: when
          };
        }
      }]);

      return Runner;
    }(EventTarget);
    Runner.id = 0;

    var FakeRunner =
    /*#__PURE__*/
    function () {
      function FakeRunner() {
        var transforms = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : new Matrix();
        var id = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : -1;
        var done = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;

        _classCallCheck(this, FakeRunner);

        this.transforms = transforms;
        this.id = id;
        this.done = done;
      }

      _createClass(FakeRunner, [{
        key: "clearTransformsFromQueue",
        value: function clearTransformsFromQueue() {}
      }]);

      return FakeRunner;
    }();

    extend([Runner, FakeRunner], {
      mergeWith: function mergeWith(runner) {
        return new FakeRunner(runner.transforms.lmultiply(this.transforms), runner.id);
      }
    }); // FakeRunner.emptyRunner = new FakeRunner()

    var lmultiply = function lmultiply(last, curr) {
      return last.lmultiplyO(curr);
    };

    var getRunnerTransform = function getRunnerTransform(runner) {
      return runner.transforms;
    };

    function mergeTransforms() {
      // Find the matrix to apply to the element and apply it
      var runners = this._transformationRunners.runners;
      var netTransform = runners.map(getRunnerTransform).reduce(lmultiply, new Matrix());
      this.transform(netTransform);

      this._transformationRunners.merge();

      if (this._transformationRunners.length() === 1) {
        this._frameId = null;
      }
    }

    var RunnerArray =
    /*#__PURE__*/
    function () {
      function RunnerArray() {
        _classCallCheck(this, RunnerArray);

        this.runners = [];
        this.ids = [];
      }

      _createClass(RunnerArray, [{
        key: "add",
        value: function add(runner) {
          if (this.runners.includes(runner)) return;
          var id = runner.id + 1;
          this.runners.push(runner);
          this.ids.push(id);
          return this;
        }
      }, {
        key: "getByID",
        value: function getByID(id) {
          return this.runners[this.ids.indexOf(id + 1)];
        }
      }, {
        key: "remove",
        value: function remove(id) {
          var index = this.ids.indexOf(id + 1);
          this.ids.splice(index, 1);
          this.runners.splice(index, 1);
          return this;
        }
      }, {
        key: "merge",
        value: function merge() {
          var _this2 = this;

          var lastRunner = null;
          this.runners.forEach(function (runner, i) {
            var condition = lastRunner && runner.done && lastRunner.done // don't merge runner when persisted on timeline
            && (!runner._timeline || !runner._timeline._runnerIds.includes(runner.id)) && (!lastRunner._timeline || !lastRunner._timeline._runnerIds.includes(lastRunner.id));

            if (condition) {
              // the +1 happens in the function
              _this2.remove(runner.id);

              _this2.edit(lastRunner.id, runner.mergeWith(lastRunner));
            }

            lastRunner = runner;
          });
          return this;
        }
      }, {
        key: "edit",
        value: function edit(id, newRunner) {
          var index = this.ids.indexOf(id + 1);
          this.ids.splice(index, 1, id + 1);
          this.runners.splice(index, 1, newRunner);
          return this;
        }
      }, {
        key: "length",
        value: function length() {
          return this.ids.length;
        }
      }, {
        key: "clearBefore",
        value: function clearBefore(id) {
          var deleteCnt = this.ids.indexOf(id + 1) || 1;
          this.ids.splice(0, deleteCnt, 0);
          this.runners.splice(0, deleteCnt, new FakeRunner()).forEach(function (r) {
            return r.clearTransformsFromQueue();
          });
          return this;
        }
      }]);

      return RunnerArray;
    }();

    registerMethods({
      Element: {
        animate: function animate(duration, delay, when) {
          var o = Runner.sanitise(duration, delay, when);
          var timeline = this.timeline();
          return new Runner(o.duration).loop(o).element(this).timeline(timeline.play()).schedule(o.delay, o.when);
        },
        delay: function delay(by, when) {
          return this.animate(0, by, when);
        },
        // this function searches for all runners on the element and deletes the ones
        // which run before the current one. This is because absolute transformations
        // overwfrite anything anyway so there is no need to waste time computing
        // other runners
        _clearTransformRunnersBefore: function _clearTransformRunnersBefore(currentRunner) {
          this._transformationRunners.clearBefore(currentRunner.id);
        },
        _currentTransform: function _currentTransform(current) {
          return this._transformationRunners.runners // we need the equal sign here to make sure, that also transformations
          // on the same runner which execute before the current transformation are
          // taken into account
          .filter(function (runner) {
            return runner.id <= current.id;
          }).map(getRunnerTransform).reduce(lmultiply, new Matrix());
        },
        _addRunner: function _addRunner(runner) {
          this._transformationRunners.add(runner); // Make sure that the runner merge is executed at the very end of
          // all Animator functions. Thats why we use immediate here to execute
          // the merge right after all frames are run


          Animator.cancelImmediate(this._frameId);
          this._frameId = Animator.immediate(mergeTransforms.bind(this));
        },
        _prepareRunner: function _prepareRunner() {
          if (this._frameId == null) {
            this._transformationRunners = new RunnerArray().add(new FakeRunner(new Matrix(this)));
          }
        }
      }
    });
    extend(Runner, {
      attr: function attr(a, v) {
        return this.styleAttr('attr', a, v);
      },
      // Add animatable styles
      css: function css(s, v) {
        return this.styleAttr('css', s, v);
      },
      styleAttr: function styleAttr(type, name, val) {
        // apply attributes individually
        if (_typeof(name) === 'object') {
          for (var key in name) {
            this.styleAttr(type, key, name[key]);
          }

          return this;
        }

        var morpher = new Morphable(this._stepper).to(val);
        this.queue(function () {
          morpher = morpher.from(this.element()[type](name));
        }, function (pos) {
          this.element()[type](name, morpher.at(pos));
          return morpher.done();
        });
        return this;
      },
      zoom: function zoom(level, point) {
        if (this._tryRetarget('zoom', to, point)) return this;
        var morpher = new Morphable(this._stepper).to(new SVGNumber(level));
        this.queue(function () {
          morpher = morpher.from(this.element().zoom());
        }, function (pos) {
          this.element().zoom(morpher.at(pos), point);
          return morpher.done();
        }, function (newLevel, newPoint) {
          point = newPoint;
          morpher.to(newLevel);
        });

        this._rememberMorpher('zoom', morpher);

        return this;
      },

      /**
       ** absolute transformations
       **/
      //
      // M v -----|-----(D M v = F v)------|----->  T v
      //
      // 1. define the final state (T) and decompose it (once)
      //    t = [tx, ty, the, lam, sy, sx]
      // 2. on every frame: pull the current state of all previous transforms
      //    (M - m can change)
      //   and then write this as m = [tx0, ty0, the0, lam0, sy0, sx0]
      // 3. Find the interpolated matrix F(pos) = m + pos * (t - m)
      //   - Note F(0) = M
      //   - Note F(1) = T
      // 4. Now you get the delta matrix as a result: D = F * inv(M)
      transform: function transform(transforms, relative, affine) {
        // If we have a declarative function, we should retarget it if possible
        relative = transforms.relative || relative;

        if (this._isDeclarative && !relative && this._tryRetarget('transform', transforms)) {
          return this;
        } // Parse the parameters


        var isMatrix = Matrix.isMatrixLike(transforms);
        affine = transforms.affine != null ? transforms.affine : affine != null ? affine : !isMatrix; // Create a morepher and set its type

        var morpher = new Morphable(this._stepper).type(affine ? TransformBag : Matrix);
        var origin;
        var element;
        var current;
        var currentAngle;
        var startTransform;

        function setup() {
          // make sure element and origin is defined
          element = element || this.element();
          origin = origin || getOrigin(transforms, element);
          startTransform = new Matrix(relative ? undefined : element); // add the runner to the element so it can merge transformations

          element._addRunner(this); // Deactivate all transforms that have run so far if we are absolute


          if (!relative) {
            element._clearTransformRunnersBefore(this);
          }
        }

        function run(pos) {
          // clear all other transforms before this in case something is saved
          // on this runner. We are absolute. We dont need these!
          if (!relative) this.clearTransform();

          var _transform = new Point(origin).transform(element._currentTransform(this)),
              x = _transform.x,
              y = _transform.y;

          var target = new Matrix(_objectSpread$1({}, transforms, {
            origin: [x, y]
          }));
          var start = this._isDeclarative && current ? current : startTransform;

          if (affine) {
            target = target.decompose(x, y);
            start = start.decompose(x, y); // Get the current and target angle as it was set

            var rTarget = target.rotate;
            var rCurrent = start.rotate; // Figure out the shortest path to rotate directly

            var possibilities = [rTarget - 360, rTarget, rTarget + 360];
            var distances = possibilities.map(function (a) {
              return Math.abs(a - rCurrent);
            });
            var shortest = Math.min.apply(Math, _toConsumableArray(distances));
            var index = distances.indexOf(shortest);
            target.rotate = possibilities[index];
          }

          if (relative) {
            // we have to be careful here not to overwrite the rotation
            // with the rotate method of Matrix
            if (!isMatrix) {
              target.rotate = transforms.rotate || 0;
            }

            if (this._isDeclarative && currentAngle) {
              start.rotate = currentAngle;
            }
          }

          morpher.from(start);
          morpher.to(target);
          var affineParameters = morpher.at(pos);
          currentAngle = affineParameters.rotate;
          current = new Matrix(affineParameters);
          this.addTransform(current);

          element._addRunner(this);

          return morpher.done();
        }

        function retarget(newTransforms) {
          // only get a new origin if it changed since the last call
          if ((newTransforms.origin || 'center').toString() !== (transforms.origin || 'center').toString()) {
            origin = getOrigin(transforms, element);
          } // overwrite the old transformations with the new ones


          transforms = _objectSpread$1({}, newTransforms, {
            origin: origin
          });
        }

        this.queue(setup, run, retarget, true);
        this._isDeclarative && this._rememberMorpher('transform', morpher);
        return this;
      },
      // Animatable x-axis
      x: function x(_x, relative) {
        return this._queueNumber('x', _x);
      },
      // Animatable y-axis
      y: function y(_y) {
        return this._queueNumber('y', _y);
      },
      dx: function dx() {
        var x = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
        return this._queueNumberDelta('x', x);
      },
      dy: function dy() {
        var y = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
        return this._queueNumberDelta('y', y);
      },
      dmove: function dmove(x, y) {
        return this.dx(x).dy(y);
      },
      _queueNumberDelta: function _queueNumberDelta(method, to) {
        to = new SVGNumber(to); // Try to change the target if we have this method already registerd

        if (this._tryRetarget(method, to)) return this; // Make a morpher and queue the animation

        var morpher = new Morphable(this._stepper).to(to);
        var from = null;
        this.queue(function () {
          from = this.element()[method]();
          morpher.from(from);
          morpher.to(from + to);
        }, function (pos) {
          this.element()[method](morpher.at(pos));
          return morpher.done();
        }, function (newTo) {
          morpher.to(from + new SVGNumber(newTo));
        }); // Register the morpher so that if it is changed again, we can retarget it

        this._rememberMorpher(method, morpher);

        return this;
      },
      _queueObject: function _queueObject(method, to) {
        // Try to change the target if we have this method already registerd
        if (this._tryRetarget(method, to)) return this; // Make a morpher and queue the animation

        var morpher = new Morphable(this._stepper).to(to);
        this.queue(function () {
          morpher.from(this.element()[method]());
        }, function (pos) {
          this.element()[method](morpher.at(pos));
          return morpher.done();
        }); // Register the morpher so that if it is changed again, we can retarget it

        this._rememberMorpher(method, morpher);

        return this;
      },
      _queueNumber: function _queueNumber(method, value) {
        return this._queueObject(method, new SVGNumber(value));
      },
      // Animatable center x-axis
      cx: function cx(x) {
        return this._queueNumber('cx', x);
      },
      // Animatable center y-axis
      cy: function cy(y) {
        return this._queueNumber('cy', y);
      },
      // Add animatable move
      move: function move(x, y) {
        return this.x(x).y(y);
      },
      // Add animatable center
      center: function center(x, y) {
        return this.cx(x).cy(y);
      },
      // Add animatable size
      size: function size(width, height) {
        // animate bbox based size for all other elements
        var box;

        if (!width || !height) {
          box = this._element.bbox();
        }

        if (!width) {
          width = box.width / box.height * height;
        }

        if (!height) {
          height = box.height / box.width * width;
        }

        return this.width(width).height(height);
      },
      // Add animatable width
      width: function width(_width) {
        return this._queueNumber('width', _width);
      },
      // Add animatable height
      height: function height(_height) {
        return this._queueNumber('height', _height);
      },
      // Add animatable plot
      plot: function plot(a, b, c, d) {
        // Lines can be plotted with 4 arguments
        if (arguments.length === 4) {
          return this.plot([a, b, c, d]);
        }

        if (this._tryRetarget('plot', a)) return this;
        var morpher = new Morphable(this._stepper).type(this._element.MorphArray).to(a);
        this.queue(function () {
          morpher.from(this._element.array());
        }, function (pos) {
          this._element.plot(morpher.at(pos));

          return morpher.done();
        });

        this._rememberMorpher('plot', morpher);

        return this;
      },
      // Add leading method
      leading: function leading(value) {
        return this._queueNumber('leading', value);
      },
      // Add animatable viewbox
      viewbox: function viewbox(x, y, width, height) {
        return this._queueObject('viewbox', new Box(x, y, width, height));
      },
      update: function update(o) {
        if (_typeof(o) !== 'object') {
          return this.update({
            offset: arguments[0],
            color: arguments[1],
            opacity: arguments[2]
          });
        }

        if (o.opacity != null) this.attr('stop-opacity', o.opacity);
        if (o.color != null) this.attr('stop-color', o.color);
        if (o.offset != null) this.attr('offset', o.offset);
        return this;
      }
    });
    extend(Runner, {
      rx: rx,
      ry: ry,
      from: from,
      to: to
    });
    register(Runner, 'Runner');

    var Svg =
    /*#__PURE__*/
    function (_Container) {
      _inherits(Svg, _Container);

      function Svg(node) {
        var _this;

        _classCallCheck(this, Svg);

        _this = _possibleConstructorReturn(this, _getPrototypeOf(Svg).call(this, nodeOrNew('svg', node), node));

        _this.namespace();

        return _this;
      }

      _createClass(Svg, [{
        key: "isRoot",
        value: function isRoot() {
          return !this.node.parentNode || !(this.node.parentNode instanceof globals$1.window.SVGElement) || this.node.parentNode.nodeName === '#document';
        } // Check if this is a root svg
        // If not, call docs from this element

      }, {
        key: "root",
        value: function root() {
          if (this.isRoot()) return this;
          return _get(_getPrototypeOf(Svg.prototype), "root", this).call(this);
        } // Add namespaces

      }, {
        key: "namespace",
        value: function namespace() {
          if (!this.isRoot()) return this.root().namespace();
          return this.attr({
            xmlns: ns,
            version: '1.1'
          }).attr('xmlns:xlink', xlink, xmlns).attr('xmlns:svgjs', svgjs, xmlns);
        } // Creates and returns defs element

      }, {
        key: "defs",
        value: function defs() {
          if (!this.isRoot()) return this.root().defs();
          return adopt(this.node.querySelector('defs')) || this.put(new Defs());
        } // custom parent method

      }, {
        key: "parent",
        value: function parent(type) {
          if (this.isRoot()) {
            return this.node.parentNode.nodeName === '#document' ? null : adopt(this.node.parentNode);
          }

          return _get(_getPrototypeOf(Svg.prototype), "parent", this).call(this, type);
        }
      }, {
        key: "clear",
        value: function clear() {
          // remove children
          while (this.node.hasChildNodes()) {
            this.node.removeChild(this.node.lastChild);
          } // remove defs reference


          delete this._defs;
          return this;
        }
      }]);

      return Svg;
    }(Container);
    registerMethods({
      Container: {
        // Create nested svg document
        nested: wrapWithAttrCheck(function () {
          return this.put(new Svg());
        })
      }
    });
    register(Svg, 'Svg', true);

    var _Symbol =
    /*#__PURE__*/
    function (_Container) {
      _inherits(_Symbol, _Container);

      // Initialize node
      function _Symbol(node) {
        _classCallCheck(this, _Symbol);

        return _possibleConstructorReturn(this, _getPrototypeOf(_Symbol).call(this, nodeOrNew('symbol', node), node));
      }

      return _Symbol;
    }(Container);
    registerMethods({
      Container: {
        symbol: wrapWithAttrCheck(function () {
          return this.put(new _Symbol());
        })
      }
    });
    register(_Symbol, 'Symbol');

    function plain(text) {
      // clear if build mode is disabled
      if (this._build === false) {
        this.clear();
      } // create text node


      this.node.appendChild(globals$1.document.createTextNode(text));
      return this;
    } // Get length of text element

    function length() {
      return this.node.getComputedTextLength();
    }

    var textable = ({
    	__proto__: null,
    	plain: plain,
    	length: length
    });

    var Text =
    /*#__PURE__*/
    function (_Shape) {
      _inherits(Text, _Shape);

      // Initialize node
      function Text(node) {
        var _this;

        _classCallCheck(this, Text);

        _this = _possibleConstructorReturn(this, _getPrototypeOf(Text).call(this, nodeOrNew('text', node), node));
        _this.dom.leading = new SVGNumber(1.3); // store leading value for rebuilding

        _this._rebuild = true; // enable automatic updating of dy values

        _this._build = false; // disable build mode for adding multiple lines

        return _this;
      } // Move over x-axis
      // Text is moved its bounding box
      // text-anchor does NOT matter


      _createClass(Text, [{
        key: "x",
        value: function x(_x) {
          var box = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : this.bbox();

          if (_x == null) {
            return box.x;
          }

          return this.attr('x', this.attr('x') + _x - box.x);
        } // Move over y-axis

      }, {
        key: "y",
        value: function y(_y) {
          var box = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : this.bbox();

          if (_y == null) {
            return box.y;
          }

          return this.attr('y', this.attr('y') + _y - box.y);
        }
      }, {
        key: "move",
        value: function move(x, y) {
          var box = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : this.bbox();
          return this.x(x, box).y(y, box);
        } // Move center over x-axis

      }, {
        key: "cx",
        value: function cx(x) {
          var box = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : this.bbox();

          if (x == null) {
            return box.cx;
          }

          return this.attr('x', this.attr('x') + x - box.cx);
        } // Move center over y-axis

      }, {
        key: "cy",
        value: function cy(y) {
          var box = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : this.bbox();

          if (y == null) {
            return box.cy;
          }

          return this.attr('y', this.attr('y') + y - box.cy);
        }
      }, {
        key: "center",
        value: function center(x, y) {
          var box = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : this.bbox();
          return this.cx(x, box).cy(y, box);
        } // Set the text content

      }, {
        key: "text",
        value: function text(_text) {
          // act as getter
          if (_text === undefined) {
            var children = this.node.childNodes;
            var firstLine = 0;
            _text = '';

            for (var i = 0, len = children.length; i < len; ++i) {
              // skip textPaths - they are no lines
              if (children[i].nodeName === 'textPath') {
                if (i === 0) firstLine = 1;
                continue;
              } // add newline if its not the first child and newLined is set to true


              if (i !== firstLine && children[i].nodeType !== 3 && adopt(children[i]).dom.newLined === true) {
                _text += '\n';
              } // add content of this node


              _text += children[i].textContent;
            }

            return _text;
          } // remove existing content


          this.clear().build(true);

          if (typeof _text === 'function') {
            // call block
            _text.call(this, this);
          } else {
            // store text and make sure text is not blank
            _text = _text.split('\n'); // build new lines

            for (var j = 0, jl = _text.length; j < jl; j++) {
              this.tspan(_text[j]).newLine();
            }
          } // disable build mode and rebuild lines


          return this.build(false).rebuild();
        } // Set / get leading

      }, {
        key: "leading",
        value: function leading(value) {
          // act as getter
          if (value == null) {
            return this.dom.leading;
          } // act as setter


          this.dom.leading = new SVGNumber(value);
          return this.rebuild();
        } // Rebuild appearance type

      }, {
        key: "rebuild",
        value: function rebuild(_rebuild) {
          // store new rebuild flag if given
          if (typeof _rebuild === 'boolean') {
            this._rebuild = _rebuild;
          } // define position of all lines


          if (this._rebuild) {
            var self = this;
            var blankLineOffset = 0;
            var leading = this.dom.leading;
            this.each(function () {
              var fontSize = globals$1.window.getComputedStyle(this.node).getPropertyValue('font-size');
              var dy = leading * new SVGNumber(fontSize);

              if (this.dom.newLined) {
                this.attr('x', self.attr('x'));

                if (this.text() === '\n') {
                  blankLineOffset += dy;
                } else {
                  this.attr('dy', dy + blankLineOffset);
                  blankLineOffset = 0;
                }
              }
            });
            this.fire('rebuild');
          }

          return this;
        } // Enable / disable build mode

      }, {
        key: "build",
        value: function build(_build) {
          this._build = !!_build;
          return this;
        } // overwrite method from parent to set data properly

      }, {
        key: "setData",
        value: function setData(o) {
          this.dom = o;
          this.dom.leading = new SVGNumber(o.leading || 1.3);
          return this;
        }
      }]);

      return Text;
    }(Shape);
    extend(Text, textable);
    registerMethods({
      Container: {
        // Create text element
        text: wrapWithAttrCheck(function (text) {
          return this.put(new Text()).text(text);
        }),
        // Create plain text element
        plain: wrapWithAttrCheck(function (text) {
          return this.put(new Text()).plain(text);
        })
      }
    });
    register(Text, 'Text');

    var Tspan =
    /*#__PURE__*/
    function (_Text) {
      _inherits(Tspan, _Text);

      // Initialize node
      function Tspan(node) {
        _classCallCheck(this, Tspan);

        return _possibleConstructorReturn(this, _getPrototypeOf(Tspan).call(this, nodeOrNew('tspan', node), node));
      } // Set text content


      _createClass(Tspan, [{
        key: "text",
        value: function text(_text) {
          if (_text == null) return this.node.textContent + (this.dom.newLined ? '\n' : '');
          typeof _text === 'function' ? _text.call(this, this) : this.plain(_text);
          return this;
        } // Shortcut dx

      }, {
        key: "dx",
        value: function dx(_dx) {
          return this.attr('dx', _dx);
        } // Shortcut dy

      }, {
        key: "dy",
        value: function dy(_dy) {
          return this.attr('dy', _dy);
        }
      }, {
        key: "x",
        value: function x(_x) {
          return this.attr('x', _x);
        }
      }, {
        key: "y",
        value: function y(_y) {
          return this.attr('x', _y);
        }
      }, {
        key: "move",
        value: function move(x, y) {
          return this.x(x).y(y);
        } // Create new line

      }, {
        key: "newLine",
        value: function newLine() {
          // fetch text parent
          var t = this.parent(Text); // mark new line

          this.dom.newLined = true;
          var fontSize = globals$1.window.getComputedStyle(this.node).getPropertyValue('font-size');
          var dy = t.dom.leading * new SVGNumber(fontSize); // apply new position

          return this.dy(dy).attr('x', t.x());
        }
      }]);

      return Tspan;
    }(Text);
    extend(Tspan, textable);
    registerMethods({
      Tspan: {
        tspan: wrapWithAttrCheck(function (text) {
          var tspan = new Tspan(); // clear if build mode is disabled

          if (!this._build) {
            this.clear();
          } // add new tspan


          this.node.appendChild(tspan.node);
          return tspan.text(text);
        })
      }
    });
    register(Tspan, 'Tspan');

    var ClipPath =
    /*#__PURE__*/
    function (_Container) {
      _inherits(ClipPath, _Container);

      function ClipPath(node) {
        _classCallCheck(this, ClipPath);

        return _possibleConstructorReturn(this, _getPrototypeOf(ClipPath).call(this, nodeOrNew('clipPath', node), node));
      } // Unclip all clipped elements and remove itself


      _createClass(ClipPath, [{
        key: "remove",
        value: function remove() {
          // unclip all targets
          this.targets().forEach(function (el) {
            el.unclip();
          }); // remove clipPath from parent

          return _get(_getPrototypeOf(ClipPath.prototype), "remove", this).call(this);
        }
      }, {
        key: "targets",
        value: function targets() {
          return baseFind('svg [clip-path*="' + this.id() + '"]');
        }
      }]);

      return ClipPath;
    }(Container);
    registerMethods({
      Container: {
        // Create clipping element
        clip: wrapWithAttrCheck(function () {
          return this.defs().put(new ClipPath());
        })
      },
      Element: {
        // Distribute clipPath to svg element
        clipWith: function clipWith(element) {
          // use given clip or create a new one
          var clipper = element instanceof ClipPath ? element : this.parent().clip().add(element); // apply mask

          return this.attr('clip-path', 'url("#' + clipper.id() + '")');
        },
        // Unclip element
        unclip: function unclip() {
          return this.attr('clip-path', null);
        },
        clipper: function clipper() {
          return this.reference('clip-path');
        }
      }
    });
    register(ClipPath, 'ClipPath');

    var ForeignObject =
    /*#__PURE__*/
    function (_Element) {
      _inherits(ForeignObject, _Element);

      function ForeignObject(node) {
        _classCallCheck(this, ForeignObject);

        return _possibleConstructorReturn(this, _getPrototypeOf(ForeignObject).call(this, nodeOrNew('foreignObject', node), node));
      }

      return ForeignObject;
    }(Element);
    registerMethods({
      Container: {
        foreignObject: wrapWithAttrCheck(function (width, height) {
          return this.put(new ForeignObject()).size(width, height);
        })
      }
    });
    register(ForeignObject, 'ForeignObject');

    var G =
    /*#__PURE__*/
    function (_Container) {
      _inherits(G, _Container);

      function G(node) {
        _classCallCheck(this, G);

        return _possibleConstructorReturn(this, _getPrototypeOf(G).call(this, nodeOrNew('g', node), node));
      }

      _createClass(G, [{
        key: "x",
        value: function x(_x) {
          var box = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : this.bbox();
          if (_x == null) return box.x;
          return this.move(_x, box.y, box);
        }
      }, {
        key: "y",
        value: function y(_y) {
          var box = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : this.bbox();
          if (_y == null) return box.y;
          return this.move(box.x, _y, box);
        }
      }, {
        key: "move",
        value: function move() {
          var x = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
          var y = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
          var box = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : this.bbox();
          var dx = x - box.x;
          var dy = y - box.y;
          return this.dmove(dx, dy);
        }
      }, {
        key: "dx",
        value: function dx(_dx) {
          return this.dmove(_dx, 0);
        }
      }, {
        key: "dy",
        value: function dy(_dy) {
          return this.dmove(0, _dy);
        }
      }, {
        key: "dmove",
        value: function dmove(dx, dy) {
          this.children().forEach(function (child, i) {
            // Get the childs bbox
            var bbox = child.bbox(); // Get childs matrix

            var m = new Matrix(child); // Translate childs matrix by amount and
            // transform it back into parents space

            var matrix = m.translate(dx, dy).transform(m.inverse()); // Calculate new x and y from old box

            var p = new Point(bbox.x, bbox.y).transform(matrix); // Move element

            child.move(p.x, p.y);
          });
          return this;
        }
      }, {
        key: "width",
        value: function width(_width) {
          var box = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : this.bbox();
          if (_width == null) return box.width;
          return this.size(_width, box.height, box);
        }
      }, {
        key: "height",
        value: function height(_height) {
          var box = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : this.bbox();
          if (_height == null) return box.height;
          return this.size(box.width, _height, box);
        }
      }, {
        key: "size",
        value: function size(width, height) {
          var box = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : this.bbox();
          var p = proportionalSize(this, width, height, box);
          var scaleX = p.width / box.width;
          var scaleY = p.height / box.height;
          this.children().forEach(function (child, i) {
            var o = new Point(box).transform(new Matrix(child).inverse());
            child.scale(scaleX, scaleY, o.x, o.y);
          });
          return this;
        }
      }]);

      return G;
    }(Container);
    registerMethods({
      Container: {
        // Create a group element
        group: wrapWithAttrCheck(function () {
          return this.put(new G());
        })
      }
    });
    register(G, 'G');

    var A =
    /*#__PURE__*/
    function (_Container) {
      _inherits(A, _Container);

      function A(node) {
        _classCallCheck(this, A);

        return _possibleConstructorReturn(this, _getPrototypeOf(A).call(this, nodeOrNew('a', node), node));
      } // Link url


      _createClass(A, [{
        key: "to",
        value: function to(url) {
          return this.attr('href', url, xlink);
        } // Link target attribute

      }, {
        key: "target",
        value: function target(_target) {
          return this.attr('target', _target);
        }
      }]);

      return A;
    }(Container);
    registerMethods({
      Container: {
        // Create a hyperlink element
        link: wrapWithAttrCheck(function (url) {
          return this.put(new A()).to(url);
        })
      },
      Element: {
        // Create a hyperlink element
        linkTo: function linkTo(url) {
          var link = new A();

          if (typeof url === 'function') {
            url.call(link, link);
          } else {
            link.to(url);
          }

          return this.parent().put(link).put(this);
        }
      }
    });
    register(A, 'A');

    var Mask =
    /*#__PURE__*/
    function (_Container) {
      _inherits(Mask, _Container);

      // Initialize node
      function Mask(node) {
        _classCallCheck(this, Mask);

        return _possibleConstructorReturn(this, _getPrototypeOf(Mask).call(this, nodeOrNew('mask', node), node));
      } // Unmask all masked elements and remove itself


      _createClass(Mask, [{
        key: "remove",
        value: function remove() {
          // unmask all targets
          this.targets().forEach(function (el) {
            el.unmask();
          }); // remove mask from parent

          return _get(_getPrototypeOf(Mask.prototype), "remove", this).call(this);
        }
      }, {
        key: "targets",
        value: function targets() {
          return baseFind('svg [mask*="' + this.id() + '"]');
        }
      }]);

      return Mask;
    }(Container);
    registerMethods({
      Container: {
        mask: wrapWithAttrCheck(function () {
          return this.defs().put(new Mask());
        })
      },
      Element: {
        // Distribute mask to svg element
        maskWith: function maskWith(element) {
          // use given mask or create a new one
          var masker = element instanceof Mask ? element : this.parent().mask().add(element); // apply mask

          return this.attr('mask', 'url("#' + masker.id() + '")');
        },
        // Unmask element
        unmask: function unmask() {
          return this.attr('mask', null);
        },
        masker: function masker() {
          return this.reference('mask');
        }
      }
    });
    register(Mask, 'Mask');

    function ownKeys$3(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

    function _objectSpread$2(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys$3(source, true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys$3(source).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

    function cssRule(selector, rule) {
      if (!selector) return '';
      if (!rule) return selector;
      var ret = selector + '{';

      for (var i in rule) {
        ret += unCamelCase(i) + ':' + rule[i] + ';';
      }

      ret += '}';
      return ret;
    }

    var Style =
    /*#__PURE__*/
    function (_Element) {
      _inherits(Style, _Element);

      function Style(node) {
        _classCallCheck(this, Style);

        return _possibleConstructorReturn(this, _getPrototypeOf(Style).call(this, nodeOrNew('style', node), node));
      }

      _createClass(Style, [{
        key: "addText",
        value: function addText() {
          var w = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
          this.node.textContent += w;
          return this;
        }
      }, {
        key: "font",
        value: function font(name, src) {
          var params = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
          return this.rule('@font-face', _objectSpread$2({
            fontFamily: name,
            src: src
          }, params));
        }
      }, {
        key: "rule",
        value: function rule(selector, obj) {
          return this.addText(cssRule(selector, obj));
        }
      }]);

      return Style;
    }(Element);
    registerMethods('Dom', {
      style: wrapWithAttrCheck(function (selector, obj) {
        return this.put(new Style()).rule(selector, obj);
      }),
      fontface: wrapWithAttrCheck(function (name, src, params) {
        return this.put(new Style()).font(name, src, params);
      })
    });
    register(Style, 'Style');

    var TextPath =
    /*#__PURE__*/
    function (_Text) {
      _inherits(TextPath, _Text);

      // Initialize node
      function TextPath(node) {
        _classCallCheck(this, TextPath);

        return _possibleConstructorReturn(this, _getPrototypeOf(TextPath).call(this, nodeOrNew('textPath', node), node));
      } // return the array of the path track element


      _createClass(TextPath, [{
        key: "array",
        value: function array() {
          var track = this.track();
          return track ? track.array() : null;
        } // Plot path if any

      }, {
        key: "plot",
        value: function plot(d) {
          var track = this.track();
          var pathArray = null;

          if (track) {
            pathArray = track.plot(d);
          }

          return d == null ? pathArray : this;
        } // Get the path element

      }, {
        key: "track",
        value: function track() {
          return this.reference('href');
        }
      }]);

      return TextPath;
    }(Text);
    registerMethods({
      Container: {
        textPath: wrapWithAttrCheck(function (text, path) {
          // Convert text to instance if needed
          if (!(text instanceof Text)) {
            text = this.text(text);
          }

          return text.path(path);
        })
      },
      Text: {
        // Create path for text to run on
        path: wrapWithAttrCheck(function (track) {
          var importNodes = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;
          var textPath = new TextPath(); // if track is a path, reuse it

          if (!(track instanceof Path)) {
            // create path element
            track = this.defs().path(track);
          } // link textPath to path and add content


          textPath.attr('href', '#' + track, xlink); // Transplant all nodes from text to textPath

          var node;

          if (importNodes) {
            while (node = this.node.firstChild) {
              textPath.node.appendChild(node);
            }
          } // add textPath element as child node and return textPath


          return this.put(textPath);
        }),
        // Get the textPath children
        textPath: function textPath() {
          return this.findOne('textPath');
        }
      },
      Path: {
        // creates a textPath from this path
        text: wrapWithAttrCheck(function (text) {
          // Convert text to instance if needed
          if (!(text instanceof Text)) {
            text = new Text().addTo(this.parent()).text(text);
          } // Create textPath from text and path and return


          return text.path(this);
        }),
        targets: function targets() {
          return baseFind('svg [href*="' + this.id() + '"]');
        }
      }
    });
    TextPath.prototype.MorphArray = PathArray;
    register(TextPath, 'TextPath');

    var Use =
    /*#__PURE__*/
    function (_Shape) {
      _inherits(Use, _Shape);

      function Use(node) {
        _classCallCheck(this, Use);

        return _possibleConstructorReturn(this, _getPrototypeOf(Use).call(this, nodeOrNew('use', node), node));
      } // Use element as a reference


      _createClass(Use, [{
        key: "element",
        value: function element(_element, file) {
          // Set lined element
          return this.attr('href', (file || '') + '#' + _element, xlink);
        }
      }]);

      return Use;
    }(Shape);
    registerMethods({
      Container: {
        // Create a use element
        use: wrapWithAttrCheck(function (element, file) {
          return this.put(new Use()).element(element, file);
        })
      }
    });
    register(Use, 'Use');

    /* Optional Modules */
    var SVG = makeInstance;
    extend([Svg, _Symbol, Image, Pattern, Marker], getMethodsFor('viewbox'));
    extend([Line, Polyline, Polygon, Path], getMethodsFor('marker'));
    extend(Text, getMethodsFor('Text'));
    extend(Path, getMethodsFor('Path'));
    extend(Defs, getMethodsFor('Defs'));
    extend([Text, Tspan], getMethodsFor('Tspan'));
    extend([Rect, Ellipse, Circle, Gradient], getMethodsFor('radius'));
    extend(EventTarget, getMethodsFor('EventTarget'));
    extend(Dom, getMethodsFor('Dom'));
    extend(Element, getMethodsFor('Element'));
    extend(Shape, getMethodsFor('Shape')); // extend(Element, getConstructor('Memory'))

    extend(Container, getMethodsFor('Container'));
    extend(Runner, getMethodsFor('Runner'));
    List.extend(getMethodNames());
    registerMorphableType([SVGNumber, Color, Box, Matrix, SVGArray, PointArray, PathArray]);
    makeMorphable();
    //# sourceMappingURL=svg.esm.js.map

    var BB = "<?xml version=\"1.0\" encoding=\"utf-8\" ?>\n<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\">\n<svg version=\"1.1\" id=\"BB\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" x=\"0px\" y=\"0px\" width=\"100%\" height=\"100%\" viewBox=\"0 0 150 150\" xml:space=\"preserve\">\n  <g id=\"BB\" transform=\"rotate(90, 65, 50) translate(15, 38)\">\n    <g id=\"background\">\n      <rect fill=\"#D9D9D9\" width=\"129.839\" height=\"100.914\" />\n    </g>\n    <rect x=\"19.67\" y=\"46.83\" fill=\"#CCC9C9\" width=\"90.5\" height=\"7.252\" />\n    <g id=\"sockets\" transform=\"translate(-4.5, -9)\">\n      <g id=\"~a1\" data-pin=\"~a1\">\n        <path fill=\"#BFBFBF\" d=\"M9.427,19.858c0-1.322,1.071-2.396,2.395-2.396c1.324,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M14.214,19.858c0,1.319-1.07,2.393-2.394,2.393c-1.324,0-2.395-1.072-2.395-2.393\" />\n        <circle fill=\"#383838\" cx=\"11.822\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b1\" data-pin=\"~b1\">\n        <path fill=\"#BFBFBF\" d=\"M9.427,27.058c0-1.322,1.071-2.396,2.395-2.396c1.324,0,2.394,1.071,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M14.214,27.058c0,1.321-1.07,2.393-2.394,2.393c-1.324,0-2.395-1.07-2.395-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"11.822\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c1\" data-pin=\"~c1\">\n        <path fill=\"#BFBFBF\" d=\"M9.427,34.256c0-1.319,1.071-2.394,2.395-2.394c1.324,0,2.394,1.072,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M14.214,34.256c0,1.322-1.07,2.396-2.394,2.396c-1.324,0-2.395-1.072-2.395-2.396\" />\n        <circle fill=\"#383838\" cx=\"11.822\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d1\" data-pin=\"~d1\">\n        <path fill=\"#BFBFBF\" d=\"M9.427,41.457c0-1.322,1.071-2.396,2.395-2.396c1.324,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M14.214,41.457c0,1.321-1.07,2.394-2.394,2.394c-1.324,0-2.395-1.07-2.395-2.394l0,0\" />\n        <circle fill=\"#383838\" cx=\"11.822\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e1\" data-pin=\"~e1\">\n        <path fill=\"#BFBFBF\" d=\"M9.427,48.657c0-1.322,1.071-2.394,2.395-2.394c1.324,0,2.394,1.07,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M14.214,48.657c0,1.322-1.07,2.395-2.394,2.395c-1.324,0-2.395-1.072-2.395-2.395l0,0\" />\n        <circle fill=\"#383838\" cx=\"11.822\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a2\" data-pin=\"~a2\">\n        <path fill=\"#BFBFBF\" d=\"M16.627,19.858c0-1.322,1.071-2.396,2.395-2.396c1.32,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M21.414,19.858c0,1.319-1.07,2.393-2.393,2.395c-1.322,0-2.396-1.07-2.396-2.393c0-0.002,0-0.002,0-0.002 \" />\n        <circle fill=\"#383838\" cx=\"19.022\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b2\" data-pin=\"~b2\">\n        <path fill=\"#BFBFBF\" d=\"M16.627,27.058c0-1.322,1.071-2.396,2.395-2.396c1.32,0,2.394,1.071,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M21.414,27.058c0,1.321-1.07,2.395-2.393,2.395c-1.322,0.002-2.396-1.07-2.396-2.393v-0.002\" />\n        <circle fill=\"#383838\" cx=\"19.022\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c2\" data-pin=\"~c2\">\n        <path fill=\"#BFBFBF\" d=\"M16.627,34.256c0-1.319,1.071-2.394,2.395-2.394c1.32,0,2.394,1.072,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M21.414,34.256c0,1.322-1.07,2.396-2.393,2.396c-1.323,0-2.396-1.069-2.396-2.393 c0-0.002,0-0.002,0-0.004\" />\n        <circle fill=\"#383838\" cx=\"19.022\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d2\" data-pin=\"~d2\">\n        <path fill=\"#BFBFBF\" d=\"M16.627,41.457c0-1.322,1.071-2.396,2.395-2.396c1.32,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M21.414,41.457c0,1.321-1.07,2.396-2.393,2.396c-1.323,0-2.396-1.07-2.396-2.394v-0.002\" />\n        <circle fill=\"#383838\" cx=\"19.022\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e2\" data-pin=\"~e2\">\n        <path fill=\"#BFBFBF\" d=\"M16.627,48.657c0-1.322,1.071-2.394,2.395-2.394c1.32,0,2.394,1.07,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M21.414,48.657c0,1.322-1.07,2.395-2.393,2.395c-1.322,0.002-2.396-1.07-2.396-2.391 c0-0.002,0-0.002,0-0.004\" />\n        <circle fill=\"#383838\" cx=\"19.022\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a3\" data-pin=\"~a3\">\n        <path fill=\"#BFBFBF\" d=\"M23.826,19.858c0-1.322,1.072-2.396,2.395-2.396c1.321,0,2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M28.615,19.858c0,1.319-1.072,2.393-2.395,2.393c-1.321,0-2.395-1.072-2.395-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"26.221\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b3\" data-pin=\"~b3\">\n        <path fill=\"#BFBFBF\" d=\"M23.826,27.058c0-1.322,1.072-2.396,2.395-2.396c1.321,0,2.395,1.071,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M28.615,27.058c0,1.321-1.072,2.393-2.395,2.393c-1.321,0-2.395-1.07-2.395-2.393\" />\n        <circle fill=\"#383838\" cx=\"26.221\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c3\" data-pin=\"~c3\">\n        <path fill=\"#BFBFBF\" d=\"M23.826,34.256c0-1.319,1.072-2.394,2.395-2.394c1.321,0,2.395,1.072,2.395,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M28.615,34.256c0,1.322-1.072,2.396-2.395,2.396c-1.321,0-2.395-1.072-2.395-2.396l0,0\" />\n        <circle fill=\"#383838\" cx=\"26.221\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d3\" data-pin=\"~d3\">\n        <path fill=\"#BFBFBF\" d=\"M23.826,41.457c0-1.322,1.072-2.396,2.395-2.396c1.321,0,2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M28.615,41.457c0,1.321-1.072,2.394-2.395,2.394c-1.321,0-2.395-1.07-2.395-2.394\" />\n        <circle fill=\"#383838\" cx=\"26.221\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e3\" data-pin=\"~e3\">\n        <path fill=\"#BFBFBF\" d=\"M23.826,48.657c0-1.322,1.072-2.394,2.395-2.394c1.321,0,2.395,1.07,2.395,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M28.615,48.657c0,1.322-1.072,2.395-2.395,2.395c-1.321,0-2.395-1.072-2.395-2.395\" />\n        <circle fill=\"#383838\" cx=\"26.221\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a4\" data-pin=\"~a4\">\n        <path fill=\"#BFBFBF\" d=\"M31.028,19.858c0-1.322,1.072-2.396,2.394-2.396c1.322,0,2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M35.815,19.858c0,1.319-1.071,2.393-2.395,2.393c-1.32,0-2.394-1.072-2.394-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"33.42\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b4\" data-pin=\"~b4\">\n        <path fill=\"#BFBFBF\" d=\"M31.028,27.058c0-1.322,1.072-2.396,2.394-2.396c1.322,0,2.395,1.071,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M35.815,27.058c0,1.321-1.071,2.393-2.395,2.393c-1.32,0-2.394-1.07-2.394-2.393\" />\n        <circle fill=\"#383838\" cx=\"33.42\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c4\" data-pin=\"~c4\">\n        <path fill=\"#BFBFBF\" d=\"M31.028,34.256c0-1.319,1.072-2.394,2.394-2.394c1.322,0,2.395,1.072,2.395,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M35.815,34.256c0,1.322-1.071,2.396-2.395,2.396c-1.32,0-2.394-1.072-2.394-2.396l0,0\" />\n        <circle fill=\"#383838\" cx=\"33.42\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d4\" data-pin=\"~d4\">\n        <path fill=\"#BFBFBF\" d=\"M31.028,41.457c0-1.322,1.072-2.396,2.394-2.396c1.322,0,2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M35.815,41.457c0,1.321-1.071,2.394-2.395,2.394c-1.32,0-2.394-1.07-2.394-2.394\" />\n        <circle fill=\"#383838\" cx=\"33.42\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e4\" data-pin=\"~e4\">\n        <path fill=\"#BFBFBF\" d=\"M31.028,48.657c0-1.322,1.072-2.394,2.394-2.394c1.322,0,2.395,1.07,2.395,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M35.815,48.657c0,1.322-1.071,2.395-2.395,2.395c-1.32,0-2.394-1.072-2.394-2.395\" />\n        <circle fill=\"#383838\" cx=\"33.42\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a5\" data-pin=\"~a5\">\n        <path fill=\"#BFBFBF\" d=\"M38.228,19.858c0-1.322,1.07-2.396,2.394-2.396c1.324,0,2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M43.015,19.858c0,1.319-1.071,2.393-2.395,2.393c-1.324,0-2.394-1.072-2.394-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"40.62\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b5\" data-pin=\"~b5\">\n        <path fill=\"#BFBFBF\" d=\"M38.228,27.058c0-1.322,1.07-2.396,2.394-2.396c1.324,0,2.395,1.071,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M43.015,27.058c0,1.321-1.071,2.393-2.395,2.393c-1.324,0-2.394-1.07-2.394-2.393\" />\n        <circle fill=\"#383838\" cx=\"40.62\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c5\" data-pin=\"~c5\">\n        <path fill=\"#BFBFBF\" d=\"M38.228,34.256c0-1.319,1.07-2.394,2.394-2.394c1.324,0,2.395,1.072,2.395,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M43.015,34.256c0,1.322-1.071,2.396-2.395,2.396c-1.324,0-2.394-1.072-2.394-2.396l0,0\" />\n        <circle fill=\"#383838\" cx=\"40.62\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d5\" data-pin=\"~d5\">\n        <path fill=\"#BFBFBF\" d=\"M38.228,41.457c0-1.322,1.07-2.396,2.394-2.396c1.324,0,2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M43.015,41.457c0,1.321-1.071,2.394-2.395,2.394c-1.324,0-2.394-1.07-2.394-2.394\" />\n        <circle fill=\"#383838\" cx=\"40.62\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e5\" data-pin=\"~e5\">\n        <path fill=\"#BFBFBF\" d=\"M38.228,48.657c0-1.322,1.07-2.394,2.394-2.394c1.324,0,2.395,1.07,2.395,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M43.015,48.657c0,1.322-1.071,2.395-2.395,2.395c-1.324,0-2.394-1.072-2.394-2.395\" />\n        <circle fill=\"#383838\" cx=\"40.62\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a6\" data-pin=\"~a6\">\n        <path fill=\"#BFBFBF\" d=\"M45.427,19.858c0-1.322,1.071-2.396,2.395-2.396c1.324,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M50.214,19.858c0,1.319-1.07,2.393-2.394,2.393c-1.324,0-2.395-1.072-2.395-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"47.822\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b6\" data-pin=\"~b6\">\n        <path fill=\"#BFBFBF\" d=\"M45.427,27.058c0-1.322,1.071-2.396,2.395-2.396c1.324,0,2.394,1.071,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M50.214,27.058c0,1.321-1.07,2.393-2.394,2.393c-1.324,0-2.395-1.07-2.395-2.393\" />\n        <circle fill=\"#383838\" cx=\"47.822\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c6\" data-pin=\"~c6\">\n        <path fill=\"#BFBFBF\" d=\"M45.427,34.256c0-1.319,1.071-2.394,2.395-2.394c1.324,0,2.394,1.072,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M50.214,34.256c0,1.322-1.07,2.396-2.394,2.396c-1.324,0-2.395-1.072-2.395-2.396l0,0\" />\n        <circle fill=\"#383838\" cx=\"47.822\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d6\" data-pin=\"~d6\">\n        <path fill=\"#BFBFBF\" d=\"M45.427,41.457c0-1.322,1.071-2.396,2.395-2.396c1.324,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M50.214,41.457c0,1.321-1.07,2.394-2.394,2.394c-1.324,0-2.395-1.07-2.395-2.394\" />\n        <circle fill=\"#383838\" cx=\"47.822\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e6\" data-pin=\"~e6\">\n        <path fill=\"#BFBFBF\" d=\"M45.427,48.657c0-1.322,1.071-2.394,2.395-2.394c1.324,0,2.394,1.07,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M50.214,48.657c0,1.322-1.07,2.395-2.394,2.395c-1.324,0-2.395-1.072-2.395-2.395\" />\n        <circle fill=\"#383838\" cx=\"47.822\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a7\" data-pin=\"~a7\">\n        <path fill=\"#BFBFBF\" d=\"M52.627,19.858c0-1.322,1.071-2.396,2.395-2.396c1.32,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M57.414,19.858c0,1.319-1.072,2.393-2.394,2.393s-2.395-1.072-2.395-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"55.022\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b7\" data-pin=\"~b7\">\n        <path fill=\"#BFBFBF\" d=\"M52.627,27.058c0-1.322,1.071-2.396,2.395-2.396c1.32,0,2.394,1.071,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M57.414,27.058c0,1.321-1.072,2.393-2.394,2.393s-2.395-1.07-2.395-2.393\" />\n        <circle fill=\"#383838\" cx=\"55.022\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c7\" data-pin=\"~c7\">\n        <path fill=\"#BFBFBF\" d=\"M52.627,34.256c0-1.319,1.071-2.394,2.395-2.394c1.32,0,2.394,1.072,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M57.414,34.256c0,1.322-1.072,2.396-2.394,2.396s-2.395-1.072-2.395-2.396l0,0\" />\n        <circle fill=\"#383838\" cx=\"55.022\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d7\" data-pin=\"~d7\">\n        <path fill=\"#BFBFBF\" d=\"M52.627,41.457c0-1.322,1.071-2.396,2.395-2.396c1.32,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M57.414,41.457c0,1.321-1.072,2.394-2.394,2.394s-2.395-1.07-2.395-2.394\" />\n        <circle fill=\"#383838\" cx=\"55.022\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e7\" data-pin=\"~e7\">\n        <path fill=\"#BFBFBF\" d=\"M52.627,48.657c0-1.322,1.071-2.394,2.395-2.394c1.32,0,2.394,1.07,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M57.414,48.657c0,1.322-1.072,2.395-2.394,2.395s-2.395-1.072-2.395-2.395\" />\n        <circle fill=\"#383838\" cx=\"55.022\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a8\" data-pin=\"~a8\">\n        <path fill=\"#BFBFBF\" d=\"M59.826,19.858c0-1.322,1.072-2.396,2.395-2.396c1.321,0,2.393,1.072,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M64.614,19.858c0,1.319-1.07,2.393-2.393,2.393c-1.323,0-2.395-1.072-2.395-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"62.221\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b8\" data-pin=\"~b8\">\n        <path fill=\"#BFBFBF\" d=\"M59.826,27.058c0-1.322,1.072-2.396,2.395-2.396c1.321,0,2.393,1.071,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M64.614,27.058c0,1.321-1.07,2.393-2.393,2.393c-1.323,0-2.395-1.07-2.395-2.393\" />\n        <circle fill=\"#383838\" cx=\"62.221\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c8\" data-pin=\"~c8\">\n        <path fill=\"#BFBFBF\" d=\"M59.826,34.256c0-1.319,1.072-2.394,2.395-2.394c1.321,0,2.393,1.072,2.393,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M64.614,34.256c0,1.322-1.07,2.396-2.393,2.396c-1.323,0-2.395-1.072-2.395-2.396l0,0\" />\n        <circle fill=\"#383838\" cx=\"62.221\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d8\" data-pin=\"~d8\">\n        <path fill=\"#BFBFBF\" d=\"M59.826,41.457c0-1.322,1.072-2.396,2.395-2.396c1.321,0,2.393,1.072,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M64.614,41.457c0,1.321-1.07,2.394-2.393,2.394c-1.323,0-2.395-1.07-2.395-2.394\" />\n        <circle fill=\"#383838\" cx=\"62.221\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e8\" data-pin=\"~e8\">\n        <path fill=\"#BFBFBF\" d=\"M59.826,48.657c0-1.322,1.072-2.394,2.395-2.394c1.321,0,2.393,1.07,2.393,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M64.614,48.657c0,1.322-1.07,2.395-2.393,2.395c-1.323,0-2.395-1.072-2.395-2.395\" />\n        <circle fill=\"#383838\" cx=\"62.221\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a9\" data-pin=\"~a9\">\n        <path fill=\"#BFBFBF\" d=\"M67.028,19.858c0-1.322,1.072-2.396,2.393-2.396c1.323,0,2.396,1.072,2.396,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M71.815,19.858c0,1.319-1.071,2.393-2.396,2.393c-1.319,0-2.393-1.072-2.393-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"69.42\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b9\" data-pin=\"~b9\">\n        <path fill=\"#BFBFBF\" d=\"M67.028,27.058c0-1.322,1.072-2.396,2.393-2.396c1.323,0,2.396,1.071,2.396,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M71.815,27.058c0,1.321-1.071,2.393-2.396,2.393c-1.319,0-2.393-1.07-2.393-2.393\" />\n        <circle fill=\"#383838\" cx=\"69.42\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c9\" data-pin=\"~c9\">\n        <path fill=\"#BFBFBF\" d=\"M67.028,34.256c0-1.319,1.072-2.394,2.393-2.394c1.323,0,2.396,1.072,2.396,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M71.815,34.256c0,1.322-1.071,2.396-2.396,2.396c-1.319,0-2.393-1.072-2.393-2.396l0,0\" />\n        <circle fill=\"#383838\" cx=\"69.42\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d9\" data-pin=\"~d9\">\n        <path fill=\"#BFBFBF\" d=\"M67.028,41.457c0-1.322,1.072-2.396,2.393-2.396c1.323,0,2.396,1.072,2.396,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M71.815,41.457c0,1.321-1.071,2.394-2.396,2.394c-1.319,0-2.393-1.07-2.393-2.394\" />\n        <circle fill=\"#383838\" cx=\"69.42\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e9\" data-pin=\"~e9\">\n        <path fill=\"#BFBFBF\" d=\"M67.028,48.657c0-1.322,1.072-2.394,2.393-2.394c1.323,0,2.396,1.07,2.396,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M71.815,48.657c0,1.322-1.071,2.395-2.396,2.395c-1.319,0-2.393-1.072-2.393-2.395\" />\n        <circle fill=\"#383838\" cx=\"69.42\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a10\" data-pin=\"~a10\">\n        <path fill=\"#BFBFBF\" d=\"M74.227,19.858c0-1.322,1.071-2.396,2.396-2.396c1.323,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M79.014,19.858c0,1.319-1.07,2.393-2.394,2.393c-1.324,0-2.396-1.072-2.396-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"76.621\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b10\" data-pin=\"~b10\">\n        <path fill=\"#BFBFBF\" d=\"M74.227,27.058c0-1.322,1.071-2.396,2.396-2.396c1.323,0,2.394,1.071,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M79.014,27.058c0,1.321-1.07,2.393-2.394,2.393c-1.324,0-2.396-1.07-2.396-2.393\" />\n        <circle fill=\"#383838\" cx=\"76.621\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c10\" data-pin=\"~c10\">\n        <path fill=\"#BFBFBF\" d=\"M74.227,34.256c0-1.319,1.071-2.394,2.396-2.394c1.323,0,2.394,1.072,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M79.014,34.256c0,1.322-1.07,2.396-2.394,2.396c-1.324,0-2.396-1.072-2.396-2.396l0,0\" />\n        <circle fill=\"#383838\" cx=\"76.621\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d10\" data-pin=\"~d10\">\n        <path fill=\"#BFBFBF\" d=\"M74.227,41.457c0-1.322,1.071-2.396,2.396-2.396c1.323,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M79.014,41.457c0,1.321-1.07,2.394-2.394,2.394c-1.324,0-2.396-1.07-2.396-2.394\" />\n        <circle fill=\"#383838\" cx=\"76.621\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e10\" data-pin=\"~e10\">\n        <path fill=\"#BFBFBF\" d=\"M74.227,48.657c0-1.322,1.071-2.394,2.396-2.394c1.323,0,2.394,1.07,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M79.014,48.657c0,1.322-1.07,2.395-2.394,2.395c-1.324,0-2.396-1.072-2.396-2.395\" />\n        <circle fill=\"#383838\" cx=\"76.621\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a11\" data-pin=\"~a11\">\n        <path fill=\"#BFBFBF\" d=\"M81.428,19.858c0-1.322,1.069-2.396,2.394-2.396s2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M86.214,19.858c0,1.319-1.07,2.393-2.395,2.393s-2.395-1.072-2.395-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"83.821\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b11\" data-pin=\"~b11\">\n        <path fill=\"#BFBFBF\" d=\"M81.428,27.058c0-1.322,1.069-2.396,2.394-2.396s2.395,1.071,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M86.214,27.058c0,1.321-1.07,2.393-2.395,2.393s-2.395-1.07-2.395-2.393\" />\n        <circle fill=\"#383838\" cx=\"83.821\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c11\" data-pin=\"~c11\">\n        <path fill=\"#BFBFBF\" d=\"M81.428,34.256c0-1.319,1.069-2.394,2.394-2.394s2.395,1.072,2.395,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M86.214,34.256c0,1.322-1.07,2.396-2.395,2.396s-2.395-1.072-2.395-2.396l0,0\" />\n        <circle fill=\"#383838\" cx=\"83.821\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d11\" data-pin=\"~d11\">\n        <path fill=\"#BFBFBF\" d=\"M81.428,41.457c0-1.322,1.069-2.396,2.394-2.396s2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M86.214,41.457c0,1.321-1.07,2.394-2.395,2.394s-2.395-1.07-2.395-2.394\" />\n        <circle fill=\"#383838\" cx=\"83.821\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e11\" data-pin=\"~e11\">\n        <path fill=\"#BFBFBF\" d=\"M81.428,48.657c0-1.322,1.069-2.394,2.394-2.394s2.395,1.07,2.395,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M86.214,48.657c0,1.322-1.07,2.395-2.395,2.395s-2.395-1.072-2.395-2.395\" />\n        <circle fill=\"#383838\" cx=\"83.821\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a12\" data-pin=\"~a12\">\n        <path fill=\"#BFBFBF\" d=\"M88.626,19.858c0-1.322,1.072-2.396,2.396-2.396c1.318,0,2.393,1.072,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M93.414,19.858c0,1.319-1.072,2.393-2.393,2.393c-1.322,0-2.396-1.072-2.396-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"91.022\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b12\" data-pin=\"~b12\">\n        <path fill=\"#BFBFBF\" d=\"M88.626,27.058c0-1.322,1.072-2.396,2.396-2.396c1.318,0,2.393,1.071,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M93.414,27.058c0,1.321-1.072,2.393-2.393,2.393c-1.322,0-2.396-1.07-2.396-2.393\" />\n        <circle fill=\"#383838\" cx=\"91.022\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c12\" data-pin=\"~c12\">\n        <path fill=\"#BFBFBF\" d=\"M88.626,34.256c0-1.319,1.072-2.394,2.396-2.394c1.318,0,2.393,1.072,2.393,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M93.414,34.256c0,1.322-1.072,2.396-2.393,2.396c-1.322,0-2.396-1.072-2.396-2.396l0,0\" />\n        <circle fill=\"#383838\" cx=\"91.022\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d12\" data-pin=\"~d12\">\n        <path fill=\"#BFBFBF\" d=\"M88.626,41.457c0-1.322,1.072-2.396,2.396-2.396c1.318,0,2.393,1.072,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M93.414,41.457c0,1.321-1.072,2.394-2.393,2.394c-1.322,0-2.396-1.07-2.396-2.394\" />\n        <circle fill=\"#383838\" cx=\"91.022\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e12\" data-pin=\"~e12\">\n        <path fill=\"#BFBFBF\" d=\"M88.626,48.657c0-1.322,1.072-2.394,2.396-2.394c1.318,0,2.393,1.07,2.393,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M93.414,48.657c0,1.322-1.072,2.395-2.393,2.395c-1.322,0-2.396-1.072-2.396-2.395\" />\n        <circle fill=\"#383838\" cx=\"91.022\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a13\" data-pin=\"~a13\">\n        <path fill=\"#BFBFBF\" d=\"M95.826,19.858c0-1.322,1.072-2.396,2.396-2.396c1.322,0,2.393,1.072,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M100.614,19.858c0,1.319-1.069,2.393-2.393,2.393s-2.396-1.072-2.396-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"98.221\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b13\" data-pin=\"~b13\">\n        <path fill=\"#BFBFBF\" d=\"M95.826,27.058c0-1.322,1.072-2.396,2.396-2.396c1.322,0,2.393,1.071,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M100.614,27.058c0,1.321-1.069,2.393-2.393,2.393s-2.396-1.07-2.396-2.393\" />\n        <circle fill=\"#383838\" cx=\"98.221\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c13\" data-pin=\"~c13\">\n        <path fill=\"#BFBFBF\" d=\"M95.826,34.256c0-1.319,1.072-2.394,2.396-2.394c1.322,0,2.393,1.072,2.393,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M100.614,34.256c0,1.322-1.069,2.396-2.393,2.396s-2.396-1.072-2.396-2.396l0,0\" />\n        <circle fill=\"#383838\" cx=\"98.221\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d13\" data-pin=\"~d13\">\n        <path fill=\"#BFBFBF\" d=\"M95.826,41.457c0-1.322,1.072-2.396,2.396-2.396c1.322,0,2.393,1.072,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M100.614,41.457c0,1.321-1.069,2.394-2.393,2.394s-2.396-1.07-2.396-2.394\" />\n        <circle fill=\"#383838\" cx=\"98.221\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e13\" data-pin=\"~e13\">\n        <path fill=\"#BFBFBF\" d=\"M95.826,48.657c0-1.322,1.072-2.394,2.396-2.394c1.322,0,2.393,1.07,2.393,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M100.614,48.657c0,1.322-1.069,2.395-2.393,2.395s-2.396-1.072-2.396-2.395\" />\n        <circle fill=\"#383838\" cx=\"98.221\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a14\" data-pin=\"~a14\">\n        <path fill=\"#BFBFBF\" d=\"M103.028,19.858c0-1.322,1.07-2.396,2.394-2.396c1.322,0,2.396,1.072,2.396,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M107.815,19.858c0,1.319-1.071,2.393-2.396,2.393c-1.322,0-2.394-1.072-2.394-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"105.419\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b14\" data-pin=\"~b14\">\n        <path fill=\"#BFBFBF\" d=\"M103.028,27.058c0-1.322,1.07-2.396,2.394-2.396c1.322,0,2.396,1.071,2.396,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M107.815,27.058c0,1.321-1.071,2.393-2.396,2.393c-1.322,0-2.394-1.07-2.394-2.393\" />\n        <circle fill=\"#383838\" cx=\"105.419\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c14\" data-pin=\"~c14\">\n        <path fill=\"#BFBFBF\" d=\"M103.028,34.256c0-1.319,1.07-2.394,2.394-2.394c1.322,0,2.396,1.072,2.396,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M107.815,34.256c0,1.322-1.071,2.396-2.396,2.396c-1.322,0-2.394-1.072-2.394-2.396l0,0\" />\n        <circle fill=\"#383838\" cx=\"105.419\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d14\" data-pin=\"~d14\">\n        <path fill=\"#BFBFBF\" d=\"M103.028,41.457c0-1.322,1.07-2.396,2.394-2.396c1.322,0,2.396,1.072,2.396,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M107.815,41.457c0,1.321-1.071,2.394-2.396,2.394c-1.322,0-2.394-1.07-2.394-2.394\" />\n        <circle fill=\"#383838\" cx=\"105.419\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e14\" data-pin=\"~e14\">\n        <path fill=\"#BFBFBF\" d=\"M103.028,48.657c0-1.322,1.07-2.394,2.394-2.394c1.322,0,2.396,1.07,2.396,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M107.815,48.657c0,1.322-1.071,2.395-2.396,2.395c-1.322,0-2.394-1.072-2.394-2.395\" />\n        <circle fill=\"#383838\" cx=\"105.419\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a15\" data-pin=\"~a15\">\n        <path fill=\"#BFBFBF\" d=\"M110.227,19.858c0.002-1.322,1.075-2.394,2.397-2.392c1.317,0.002,2.387,1.07,2.39,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M115.014,19.858c0.002,1.319-1.068,2.395-2.39,2.396c-1.322,0.002-2.396-1.067-2.397-2.392 c0-0.002,0-0.004,0-0.006\" />\n        <circle fill=\"#383838\" cx=\"112.621\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b15\" data-pin=\"~b15\">\n        <path fill=\"#BFBFBF\" d=\"M110.227,27.058c0.002-1.322,1.075-2.394,2.397-2.392c1.317,0.002,2.387,1.071,2.39,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M115.014,27.058c0.002,1.321-1.068,2.395-2.39,2.396c-1.322,0.002-2.396-1.068-2.397-2.39 c0-0.004,0-0.006,0-0.008\" />\n        <circle fill=\"#383838\" cx=\"112.621\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c15\" data-pin=\"~c15\">\n        <path fill=\"#BFBFBF\" d=\"M110.227,34.256c0.002-1.319,1.075-2.392,2.397-2.39c1.317,0.003,2.387,1.07,2.39,2.39\" />\n        <path fill=\"#E6E6E6\" d=\"M115.014,34.256c0.002,1.322-1.068,2.396-2.39,2.397c-1.322,0.002-2.396-1.067-2.397-2.391 c0-0.002,0-0.004,0-0.008\" />\n        <circle fill=\"#383838\" cx=\"112.621\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d15\" data-pin=\"~d15\">\n        <path fill=\"#BFBFBF\" d=\"M110.227,41.457c0.002-1.322,1.075-2.394,2.397-2.392c1.317,0.002,2.387,1.07,2.39,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M115.014,41.457c0.002,1.321-1.068,2.396-2.39,2.396c-1.322,0.002-2.396-1.067-2.397-2.391 c0-0.002,0-0.004,0-0.006\" />\n        <circle fill=\"#383838\" cx=\"112.621\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e15\" data-pin=\"~e15\">\n        <path fill=\"#BFBFBF\" d=\"M110.227,48.657c0.002-1.322,1.075-2.394,2.397-2.391c1.317,0.002,2.387,1.071,2.39,2.391\" />\n        <path fill=\"#E6E6E6\" d=\"M115.014,48.657c0.002,1.322-1.068,2.395-2.39,2.396c-1.322,0.005-2.396-1.065-2.397-2.389 c0-0.002,0-0.007,0-0.009\" />\n        <circle fill=\"#383838\" cx=\"112.621\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a16\" data-pin=\"~a16\">\n        <path fill=\"#BFBFBF\" d=\"M117.428,19.858c0.003-1.322,1.073-2.394,2.396-2.392c1.318,0.002,2.389,1.07,2.391,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M122.214,19.858c0.002,1.319-1.066,2.395-2.391,2.396s-2.395-1.067-2.396-2.392c0-0.002,0-0.004,0-0.006\" />\n        <circle fill=\"#383838\" cx=\"119.821\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b16\" data-pin=\"~b16\">\n        <path fill=\"#BFBFBF\" d=\"M117.428,27.058c0.003-1.322,1.073-2.394,2.396-2.392c1.318,0.002,2.389,1.071,2.391,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M122.214,27.058c0.002,1.321-1.066,2.395-2.391,2.396s-2.395-1.068-2.396-2.39c0-0.004,0-0.006,0-0.008\" />\n        <circle fill=\"#383838\" cx=\"119.821\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c16\" data-pin=\"~c16\">\n        <path fill=\"#BFBFBF\" d=\"M117.428,34.256c0.003-1.319,1.073-2.392,2.396-2.39c1.318,0.003,2.389,1.07,2.391,2.39\" />\n        <path fill=\"#E6E6E6\" d=\"M122.214,34.256c0.002,1.322-1.066,2.396-2.391,2.397s-2.395-1.067-2.396-2.391c0-0.002,0-0.004,0-0.008\" />\n        <circle fill=\"#383838\" cx=\"119.821\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d16\" data-pin=\"~d16\">\n        <path fill=\"#BFBFBF\" d=\"M117.428,41.457c0.003-1.322,1.073-2.394,2.396-2.392c1.318,0.002,2.389,1.07,2.391,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M122.214,41.457c0.002,1.321-1.066,2.396-2.391,2.396c-1.322,0.002-2.395-1.067-2.396-2.391 c0-0.002,0-0.004,0-0.006\" />\n        <circle fill=\"#383838\" cx=\"119.821\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e16\" data-pin=\"~e16\">\n        <path fill=\"#BFBFBF\" d=\"M117.428,48.657c0.003-1.322,1.073-2.394,2.396-2.391c1.318,0.002,2.389,1.071,2.391,2.391\" />\n        <path fill=\"#E6E6E6\" d=\"M122.214,48.657c0.002,1.322-1.066,2.395-2.391,2.396c-1.322,0.005-2.395-1.065-2.396-2.389 c0-0.002,0-0.007,0-0.009\" />\n        <circle fill=\"#383838\" cx=\"119.821\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~a17\" data-pin=\"~a17\">\n        <path fill=\"#BFBFBF\" d=\"M124.626,19.858c0.002-1.322,1.074-2.394,2.396-2.392c1.318,0.002,2.389,1.07,2.391,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M129.414,19.858c0.002,1.319-1.067,2.395-2.392,2.396c-1.321,0.002-2.396-1.067-2.396-2.392 c0-0.002,0-0.004,0-0.006\" />\n        <circle fill=\"#383838\" cx=\"127.02\" cy=\"19.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~b17\" data-pin=\"~b17\">\n        <path fill=\"#BFBFBF\" d=\"M124.626,27.058c0.002-1.322,1.074-2.394,2.396-2.392c1.318,0.002,2.389,1.071,2.391,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M129.414,27.058c0.002,1.321-1.067,2.395-2.392,2.396c-1.321,0.002-2.396-1.068-2.396-2.39 c0-0.004,0-0.006,0-0.008\" />\n        <circle fill=\"#383838\" cx=\"127.02\" cy=\"27.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~c17\" data-pin=\"~c17\">\n        <path fill=\"#BFBFBF\" d=\"M124.626,34.256c0.002-1.319,1.074-2.392,2.396-2.39c1.318,0.003,2.389,1.07,2.391,2.39\" />\n        <path fill=\"#E6E6E6\" d=\"M129.414,34.256c0.002,1.322-1.067,2.396-2.392,2.397c-1.321,0.002-2.396-1.067-2.396-2.391 c0-0.002,0-0.004,0-0.008\" />\n        <circle fill=\"#383838\" cx=\"127.02\" cy=\"34.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~d17\" data-pin=\"~d17\">\n        <path fill=\"#BFBFBF\" d=\"M124.626,41.457c0.002-1.322,1.074-2.394,2.396-2.392c1.318,0.002,2.389,1.07,2.391,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M129.414,41.457c0.002,1.321-1.067,2.396-2.392,2.396c-1.321,0.002-2.396-1.067-2.396-2.391 c0-0.002,0-0.004,0-0.006\" />\n        <circle fill=\"#383838\" cx=\"127.02\" cy=\"41.457\" r=\"1.197\" />\n      </g>\n      <g id=\"~e17\" data-pin=\"~e17\">\n        <path fill=\"#BFBFBF\" d=\"M124.626,48.657c0.002-1.322,1.074-2.394,2.396-2.391c1.318,0.002,2.389,1.071,2.391,2.391\" />\n        <path fill=\"#E6E6E6\" d=\"M129.414,48.657c0.002,1.322-1.067,2.395-2.392,2.396c-1.321,0.005-2.396-1.065-2.396-2.389 c0-0.002,0-0.007,0-0.009\" />\n        <circle fill=\"#383838\" cx=\"127.02\" cy=\"48.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~f1\" data-pin=\"~f1\">\n        <path fill=\"#BFBFBF\" d=\"M9.427,70.256c0-1.32,1.071-2.395,2.395-2.395c1.324,0,2.394,1.07,2.394,2.395\" />\n        <path fill=\"#E6E6E6\" d=\"M14.214,70.256c0,1.322-1.07,2.396-2.394,2.396c-1.324,0-2.395-1.072-2.395-2.396l0,0\" />\n        <circle fill=\"#383838\" cx=\"11.822\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g1\" data-pin=\"~g1\">\n        <path fill=\"#BFBFBF\" d=\"M9.427,77.457c0-1.322,1.071-2.396,2.395-2.396c1.324,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M14.214,77.457c0,1.32-1.07,2.395-2.394,2.395c-1.324,0-2.395-1.07-2.395-2.395l0,0\" />\n        <circle fill=\"#383838\" cx=\"11.822\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h1\" data-pin=\"~h1\">\n        <path fill=\"#BFBFBF\" d=\"M9.427,84.657c0-1.322,1.071-2.394,2.395-2.394c1.324,0,2.394,1.069,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M14.214,84.657c0,1.321-1.07,2.395-2.394,2.395c-1.324,0-2.395-1.071-2.395-2.395\" />\n        <circle fill=\"#383838\" cx=\"11.822\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i1\" data-pin=\"~i1\">\n        <path fill=\"#BFBFBF\" d=\"M9.427,91.857c0-1.321,1.071-2.396,2.395-2.396c1.324,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M14.214,91.857c0,1.319-1.07,2.394-2.394,2.394c-1.324,0-2.395-1.071-2.395-2.394l0,0\" />\n        <circle fill=\"#383838\" cx=\"11.822\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j1\" data-pin=\"~j1\">\n        <path fill=\"#BFBFBF\" d=\"M9.427,99.059c0-1.322,1.071-2.396,2.395-2.396c1.324,0,2.394,1.07,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M14.214,99.059c0,1.32-1.07,2.393-2.394,2.393c-1.324,0-2.395-1.07-2.395-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"11.822\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f2\" data-pin=\"~f2\">\n        <path fill=\"#BFBFBF\" d=\"M16.627,70.256c0-1.32,1.071-2.395,2.395-2.395c1.32,0,2.394,1.07,2.394,2.395\" />\n        <path fill=\"#E6E6E6\" d=\"M21.414,70.256c0,1.322-1.07,2.396-2.393,2.396c-1.323,0-2.396-1.069-2.396-2.394 c0-0.002,0-0.002,0-0.004\" />\n        <circle fill=\"#383838\" cx=\"19.022\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g2\" data-pin=\"~g2\">\n        <path fill=\"#BFBFBF\" d=\"M16.627,77.457c0-1.322,1.071-2.396,2.395-2.396c1.32,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M21.414,77.457c0,1.32-1.07,2.396-2.393,2.396c-1.323,0-2.396-1.07-2.396-2.395v-0.002\" />\n        <circle fill=\"#383838\" cx=\"19.022\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h2\" data-pin=\"~h2\">\n        <path fill=\"#BFBFBF\" d=\"M16.627,84.657c0-1.322,1.071-2.394,2.395-2.394c1.32,0,2.394,1.069,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M21.414,84.657c0,1.321-1.07,2.395-2.393,2.395c-1.322,0.003-2.396-1.069-2.396-2.393c0,0,0,0,0-0.002\" />\n        <circle fill=\"#383838\" cx=\"19.022\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i2\" data-pin=\"~i2\">\n        <path fill=\"#BFBFBF\" d=\"M16.627,91.857c0-1.321,1.071-2.396,2.395-2.396c1.32,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M21.414,91.857c0,1.319-1.07,2.394-2.393,2.396c-1.322,0-2.396-1.069-2.396-2.394 c0-0.002,0-0.002,0-0.002\" />\n        <circle fill=\"#383838\" cx=\"19.022\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j2\" data-pin=\"~j2\">\n        <path fill=\"#BFBFBF\" d=\"M16.627,99.059c0-1.322,1.071-2.396,2.395-2.396c1.32,0,2.394,1.07,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M21.414,99.059c0,1.32-1.07,2.395-2.393,2.395c-1.323,0-2.396-1.07-2.396-2.393v-0.002\" />\n        <circle fill=\"#383838\" cx=\"19.022\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f3\" data-pin=\"~f3\">\n        <path fill=\"#BFBFBF\" d=\"M23.826,70.256c0-1.32,1.072-2.395,2.395-2.395c1.321,0,2.395,1.07,2.395,2.395\" />\n        <path fill=\"#E6E6E6\" d=\"M28.615,70.256c0,1.322-1.072,2.396-2.395,2.396c-1.321,0-2.395-1.072-2.395-2.396\" />\n        <circle fill=\"#383838\" cx=\"26.221\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g3\" data-pin=\"~g3\">\n        <path fill=\"#BFBFBF\" d=\"M23.826,77.457c0-1.322,1.072-2.396,2.395-2.396c1.321,0,2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M28.615,77.457c0,1.32-1.072,2.395-2.395,2.395c-1.321,0-2.395-1.07-2.395-2.395\" />\n        <circle fill=\"#383838\" cx=\"26.221\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h3\" data-pin=\"~h3\">\n        <path fill=\"#BFBFBF\" d=\"M23.826,84.657c0-1.322,1.072-2.394,2.395-2.394c1.321,0,2.395,1.069,2.395,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M28.615,84.657c0,1.321-1.072,2.395-2.395,2.395c-1.321,0-2.395-1.071-2.395-2.395l0,0\" />\n        <circle fill=\"#383838\" cx=\"26.221\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i3\" data-pin=\"~i3\">\n        <path fill=\"#BFBFBF\" d=\"M23.826,91.857c0-1.321,1.072-2.396,2.395-2.396c1.321,0,2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M28.615,91.857c0,1.319-1.072,2.394-2.395,2.394c-1.321,0-2.395-1.071-2.395-2.394\" />\n        <circle fill=\"#383838\" cx=\"26.221\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j3\" data-pin=\"~j3\">\n        <path fill=\"#BFBFBF\" d=\"M23.826,99.059c0-1.322,1.072-2.396,2.395-2.396c1.321,0,2.395,1.07,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M28.615,99.059c0,1.32-1.072,2.393-2.395,2.393c-1.321,0-2.395-1.07-2.395-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"26.221\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f4\" data-pin=\"~f4\">\n        <path fill=\"#BFBFBF\" d=\"M31.028,70.256c0-1.32,1.072-2.395,2.394-2.395c1.322,0,2.395,1.07,2.395,2.395\" />\n        <path fill=\"#E6E6E6\" d=\"M35.815,70.256c0,1.322-1.071,2.396-2.395,2.396c-1.32,0-2.394-1.072-2.394-2.396\" />\n        <circle fill=\"#383838\" cx=\"33.42\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g4\" data-pin=\"~g4\">\n        <path fill=\"#BFBFBF\" d=\"M31.028,77.457c0-1.322,1.072-2.396,2.394-2.396c1.322,0,2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M35.815,77.457c0,1.32-1.071,2.395-2.395,2.395c-1.32,0-2.394-1.07-2.394-2.395\" />\n        <circle fill=\"#383838\" cx=\"33.42\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h4\" data-pin=\"~h4\">\n        <path fill=\"#BFBFBF\" d=\"M31.028,84.657c0-1.322,1.072-2.394,2.394-2.394c1.322,0,2.395,1.069,2.395,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M35.815,84.657c0,1.321-1.071,2.395-2.395,2.395c-1.32,0-2.394-1.071-2.394-2.395l0,0\" />\n        <circle fill=\"#383838\" cx=\"33.42\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i4\" data-pin=\"~i4\">\n        <path fill=\"#BFBFBF\" d=\"M31.028,91.857c0-1.321,1.072-2.396,2.394-2.396c1.322,0,2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M35.815,91.857c0,1.319-1.071,2.394-2.395,2.394c-1.32,0-2.394-1.071-2.394-2.394\" />\n        <circle fill=\"#383838\" cx=\"33.42\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j4\" data-pin=\"~j4\">\n        <path fill=\"#BFBFBF\" d=\"M31.028,99.059c0-1.322,1.072-2.396,2.394-2.396c1.322,0,2.395,1.07,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M35.815,99.059c0,1.32-1.071,2.393-2.395,2.393c-1.32,0-2.394-1.07-2.394-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"33.42\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f5\" data-pin=\"~f5\">\n        <path fill=\"#BFBFBF\" d=\"M38.228,70.256c0-1.32,1.07-2.395,2.394-2.395c1.324,0,2.395,1.07,2.395,2.395\" />\n        <path fill=\"#E6E6E6\" d=\"M43.015,70.256c0,1.322-1.071,2.396-2.395,2.396c-1.324,0-2.394-1.072-2.394-2.396\" />\n        <circle fill=\"#383838\" cx=\"40.62\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g5\" data-pin=\"~g5\">\n        <path fill=\"#BFBFBF\" d=\"M38.228,77.457c0-1.322,1.07-2.396,2.394-2.396c1.324,0,2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M43.015,77.457c0,1.32-1.071,2.395-2.395,2.395c-1.324,0-2.394-1.07-2.394-2.395\" />\n        <circle fill=\"#383838\" cx=\"40.62\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h5\" data-pin=\"~h5\">\n        <path fill=\"#BFBFBF\" d=\"M38.228,84.657c0-1.322,1.07-2.394,2.394-2.394c1.324,0,2.395,1.069,2.395,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M43.015,84.657c0,1.321-1.071,2.395-2.395,2.395c-1.324,0-2.394-1.071-2.394-2.395l0,0\" />\n        <circle fill=\"#383838\" cx=\"40.62\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i5\" data-pin=\"~i5\">\n        <path fill=\"#BFBFBF\" d=\"M38.228,91.857c0-1.321,1.07-2.396,2.394-2.396c1.324,0,2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M43.015,91.857c0,1.319-1.071,2.394-2.395,2.394c-1.324,0-2.394-1.071-2.394-2.394\" />\n        <circle fill=\"#383838\" cx=\"40.62\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j5\" data-pin=\"~j5\">\n        <path fill=\"#BFBFBF\" d=\"M38.228,99.059c0-1.322,1.07-2.396,2.394-2.396c1.324,0,2.395,1.07,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M43.015,99.059c0,1.32-1.071,2.393-2.395,2.393c-1.324,0-2.394-1.07-2.394-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"40.62\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f6\" data-pin=\"~f6\">\n        <path fill=\"#BFBFBF\" d=\"M45.427,70.256c0-1.32,1.071-2.395,2.395-2.395c1.324,0,2.394,1.07,2.394,2.395\" />\n        <path fill=\"#E6E6E6\" d=\"M50.214,70.256c0,1.322-1.07,2.396-2.394,2.396c-1.324,0-2.395-1.072-2.395-2.396\" />\n        <circle fill=\"#383838\" cx=\"47.822\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g6\" data-pin=\"~g6\">\n        <path fill=\"#BFBFBF\" d=\"M45.427,77.457c0-1.322,1.071-2.396,2.395-2.396c1.324,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M50.214,77.457c0,1.32-1.07,2.395-2.394,2.395c-1.324,0-2.395-1.07-2.395-2.395\" />\n        <circle fill=\"#383838\" cx=\"47.822\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h6\" data-pin=\"~h6\">\n        <path fill=\"#BFBFBF\" d=\"M45.427,84.657c0-1.322,1.071-2.394,2.395-2.394c1.324,0,2.394,1.069,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M50.214,84.657c0,1.321-1.07,2.395-2.394,2.395c-1.324,0-2.395-1.071-2.395-2.395l0,0\" />\n        <circle fill=\"#383838\" cx=\"47.822\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i6\" data-pin=\"~i6\">\n        <path fill=\"#BFBFBF\" d=\"M45.427,91.857c0-1.321,1.071-2.396,2.395-2.396c1.324,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M50.214,91.857c0,1.319-1.07,2.394-2.394,2.394c-1.324,0-2.395-1.071-2.395-2.394\" />\n        <circle fill=\"#383838\" cx=\"47.822\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j6\" data-pin=\"~j6\">\n        <path fill=\"#BFBFBF\" d=\"M45.427,99.059c0-1.322,1.071-2.396,2.395-2.396c1.324,0,2.394,1.07,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M50.214,99.059c0,1.32-1.07,2.393-2.394,2.393c-1.324,0-2.395-1.07-2.395-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"47.822\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f7\" data-pin=\"~f7\">\n        <path fill=\"#BFBFBF\" d=\"M52.627,70.256c0-1.32,1.071-2.395,2.395-2.395c1.32,0,2.394,1.07,2.394,2.395\" />\n        <path fill=\"#E6E6E6\" d=\"M57.414,70.256c0,1.322-1.072,2.396-2.394,2.396s-2.395-1.072-2.395-2.396\" />\n        <circle fill=\"#383838\" cx=\"55.022\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g7\" data-pin=\"~g7\">\n        <path fill=\"#BFBFBF\" d=\"M52.627,77.457c0-1.322,1.071-2.396,2.395-2.396c1.32,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M57.414,77.457c0,1.32-1.072,2.395-2.394,2.395s-2.395-1.07-2.395-2.395\" />\n        <circle fill=\"#383838\" cx=\"55.022\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h7\" data-pin=\"~h7\">\n        <path fill=\"#BFBFBF\" d=\"M52.627,84.657c0-1.322,1.071-2.394,2.395-2.394c1.32,0,2.394,1.069,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M57.414,84.657c0,1.321-1.072,2.395-2.394,2.395s-2.395-1.071-2.395-2.395l0,0\" />\n        <circle fill=\"#383838\" cx=\"55.022\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i7\" data-pin=\"~i7\">\n        <path fill=\"#BFBFBF\" d=\"M52.627,91.857c0-1.321,1.071-2.396,2.395-2.396c1.32,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M57.414,91.857c0,1.319-1.072,2.394-2.394,2.394s-2.395-1.071-2.395-2.394\" />\n        <circle fill=\"#383838\" cx=\"55.022\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j7\" data-pin=\"~j7\">\n        <path fill=\"#BFBFBF\" d=\"M52.627,99.059c0-1.322,1.071-2.396,2.395-2.396c1.32,0,2.394,1.07,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M57.414,99.059c0,1.32-1.072,2.393-2.394,2.393s-2.395-1.07-2.395-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"55.022\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f8\" data-pin=\"~f8\">\n        <path fill=\"#BFBFBF\" d=\"M59.826,70.256c0-1.32,1.072-2.395,2.395-2.395c1.321,0,2.393,1.07,2.393,2.395\" />\n        <path fill=\"#E6E6E6\" d=\"M64.614,70.256c0,1.322-1.07,2.396-2.393,2.396c-1.323,0-2.395-1.072-2.395-2.396\" />\n        <circle fill=\"#383838\" cx=\"62.221\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g8\" data-pin=\"~g8\">\n        <path fill=\"#BFBFBF\" d=\"M59.826,77.457c0-1.322,1.072-2.396,2.395-2.396c1.321,0,2.393,1.072,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M64.614,77.457c0,1.32-1.07,2.395-2.393,2.395c-1.323,0-2.395-1.07-2.395-2.395\" />\n        <circle fill=\"#383838\" cx=\"62.221\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h8\" data-pin=\"~h8\">\n        <path fill=\"#BFBFBF\" d=\"M59.826,84.657c0-1.322,1.072-2.394,2.395-2.394c1.321,0,2.393,1.069,2.393,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M64.614,84.657c0,1.321-1.07,2.395-2.393,2.395c-1.323,0-2.395-1.071-2.395-2.395l0,0\" />\n        <circle fill=\"#383838\" cx=\"62.221\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i8\" data-pin=\"~i8\">\n        <path fill=\"#BFBFBF\" d=\"M59.826,91.857c0-1.321,1.072-2.396,2.395-2.396c1.321,0,2.393,1.072,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M64.614,91.857c0,1.319-1.07,2.394-2.393,2.394c-1.323,0-2.395-1.071-2.395-2.394\" />\n        <circle fill=\"#383838\" cx=\"62.221\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j8\" data-pin=\"~j8\">\n        <path fill=\"#BFBFBF\" d=\"M59.826,99.059c0-1.322,1.072-2.396,2.395-2.396c1.321,0,2.393,1.07,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M64.614,99.059c0,1.32-1.07,2.393-2.393,2.393c-1.323,0-2.395-1.07-2.395-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"62.221\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f9\" data-pin=\"~f9\">\n        <path fill=\"#BFBFBF\" d=\"M67.028,70.256c0-1.32,1.072-2.395,2.393-2.395c1.323,0,2.396,1.07,2.396,2.395\" />\n        <path fill=\"#E6E6E6\" d=\"M71.815,70.256c0,1.322-1.071,2.396-2.396,2.396c-1.319,0-2.393-1.072-2.393-2.396\" />\n        <circle fill=\"#383838\" cx=\"69.42\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g9\" data-pin=\"~g9\">\n        <path fill=\"#BFBFBF\" d=\"M67.028,77.457c0-1.322,1.072-2.396,2.393-2.396c1.323,0,2.396,1.072,2.396,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M71.815,77.457c0,1.32-1.071,2.395-2.396,2.395c-1.319,0-2.393-1.07-2.393-2.395\" />\n        <circle fill=\"#383838\" cx=\"69.42\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h9\" data-pin=\"~h9\">\n        <path fill=\"#BFBFBF\" d=\"M67.028,84.657c0-1.322,1.072-2.394,2.393-2.394c1.323,0,2.396,1.069,2.396,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M71.815,84.657c0,1.321-1.071,2.395-2.396,2.395c-1.319,0-2.393-1.071-2.393-2.395l0,0\" />\n        <circle fill=\"#383838\" cx=\"69.42\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i9\" data-pin=\"~i9\">\n        <path fill=\"#BFBFBF\" d=\"M67.028,91.857c0-1.321,1.072-2.396,2.393-2.396c1.323,0,2.396,1.072,2.396,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M71.815,91.857c0,1.319-1.071,2.394-2.396,2.394c-1.319,0-2.393-1.071-2.393-2.394\" />\n        <circle fill=\"#383838\" cx=\"69.42\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j9\" data-pin=\"~j9\">\n        <path fill=\"#BFBFBF\" d=\"M67.028,99.059c0-1.322,1.072-2.396,2.393-2.396c1.323,0,2.396,1.07,2.396,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M71.815,99.059c0,1.32-1.071,2.393-2.396,2.393c-1.319,0-2.393-1.07-2.393-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"69.42\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f10\" data-pin=\"~f10\">\n        <path fill=\"#BFBFBF\" d=\"M74.227,70.256c0-1.32,1.071-2.395,2.396-2.395c1.323,0,2.394,1.07,2.394,2.395\" />\n        <path fill=\"#E6E6E6\" d=\"M79.014,70.256c0,1.322-1.07,2.396-2.394,2.396c-1.324,0-2.396-1.072-2.396-2.396\" />\n        <circle fill=\"#383838\" cx=\"76.621\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g10\" data-pin=\"~g10\">\n        <path fill=\"#BFBFBF\" d=\"M74.227,77.457c0-1.322,1.071-2.396,2.396-2.396c1.323,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M79.014,77.457c0,1.32-1.07,2.395-2.394,2.395c-1.324,0-2.396-1.07-2.396-2.395\" />\n        <circle fill=\"#383838\" cx=\"76.621\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h10\" data-pin=\"~h10\">\n        <path fill=\"#BFBFBF\" d=\"M74.227,84.657c0-1.322,1.071-2.394,2.396-2.394c1.323,0,2.394,1.069,2.394,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M79.014,84.657c0,1.321-1.07,2.395-2.394,2.395c-1.324,0-2.396-1.071-2.396-2.395l0,0\" />\n        <circle fill=\"#383838\" cx=\"76.621\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i10\" data-pin=\"~i10\">\n        <path fill=\"#BFBFBF\" d=\"M74.227,91.857c0-1.321,1.071-2.396,2.396-2.396c1.323,0,2.394,1.072,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M79.014,91.857c0,1.319-1.07,2.394-2.394,2.394c-1.324,0-2.396-1.071-2.396-2.394\" />\n        <circle fill=\"#383838\" cx=\"76.621\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j10\" data-pin=\"~j10\">\n        <path fill=\"#BFBFBF\" d=\"M74.227,99.059c0-1.322,1.071-2.396,2.396-2.396c1.323,0,2.394,1.07,2.394,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M79.014,99.059c0,1.32-1.07,2.393-2.394,2.393c-1.324,0-2.396-1.07-2.396-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"76.621\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f11\" data-pin=\"~f11\">\n        <path fill=\"#BFBFBF\" d=\"M81.428,70.256c0-1.32,1.069-2.395,2.394-2.395s2.395,1.07,2.395,2.395\" />\n        <path fill=\"#E6E6E6\" d=\"M86.214,70.256c0,1.322-1.07,2.396-2.395,2.396s-2.395-1.072-2.395-2.396\" />\n        <circle fill=\"#383838\" cx=\"83.821\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g11\" data-pin=\"~g11\">\n        <path fill=\"#BFBFBF\" d=\"M81.428,77.457c0-1.322,1.069-2.396,2.394-2.396s2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M86.214,77.457c0,1.32-1.07,2.395-2.395,2.395s-2.395-1.07-2.395-2.395\" />\n        <circle fill=\"#383838\" cx=\"83.821\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h11\" data-pin=\"~h11\">\n        <path fill=\"#BFBFBF\" d=\"M81.428,84.657c0-1.322,1.069-2.394,2.394-2.394s2.395,1.069,2.395,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M86.214,84.657c0,1.321-1.07,2.395-2.395,2.395s-2.395-1.071-2.395-2.395l0,0\" />\n        <circle fill=\"#383838\" cx=\"83.821\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i11\" data-pin=\"~i11\">\n        <path fill=\"#BFBFBF\" d=\"M81.428,91.857c0-1.321,1.069-2.396,2.394-2.396s2.395,1.072,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M86.214,91.857c0,1.319-1.07,2.394-2.395,2.394s-2.395-1.071-2.395-2.394\" />\n        <circle fill=\"#383838\" cx=\"83.821\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j11\" data-pin=\"~j11\">\n        <path fill=\"#BFBFBF\" d=\"M81.428,99.059c0-1.322,1.069-2.396,2.394-2.396s2.395,1.07,2.395,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M86.214,99.059c0,1.32-1.07,2.393-2.395,2.393s-2.395-1.07-2.395-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"83.821\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f12\" data-pin=\"~f12\">\n        <path fill=\"#BFBFBF\" d=\"M88.626,70.256c0-1.32,1.072-2.395,2.396-2.395c1.318,0,2.393,1.07,2.393,2.395\" />\n        <path fill=\"#E6E6E6\" d=\"M93.414,70.256c0,1.322-1.072,2.396-2.393,2.396c-1.322,0-2.396-1.072-2.396-2.396\" />\n        <circle fill=\"#383838\" cx=\"91.022\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g12\" data-pin=\"~g12\">\n        <path fill=\"#BFBFBF\" d=\"M88.626,77.457c0-1.322,1.072-2.396,2.396-2.396c1.318,0,2.393,1.072,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M93.414,77.457c0,1.32-1.072,2.395-2.393,2.395c-1.322,0-2.396-1.07-2.396-2.395\" />\n        <circle fill=\"#383838\" cx=\"91.022\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h12\" data-pin=\"~h12\">\n        <path fill=\"#BFBFBF\" d=\"M88.626,84.657c0-1.322,1.072-2.394,2.396-2.394c1.318,0,2.393,1.069,2.393,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M93.414,84.657c0,1.321-1.072,2.395-2.393,2.395c-1.322,0-2.396-1.071-2.396-2.395l0,0\" />\n        <circle fill=\"#383838\" cx=\"91.022\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i12\" data-pin=\"~i12\">\n        <path fill=\"#BFBFBF\" d=\"M88.626,91.857c0-1.321,1.072-2.396,2.396-2.396c1.318,0,2.393,1.072,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M93.414,91.857c0,1.319-1.072,2.394-2.393,2.394c-1.322,0-2.396-1.071-2.396-2.394\" />\n        <circle fill=\"#383838\" cx=\"91.022\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j12\" data-pin=\"~j12\">\n        <path fill=\"#BFBFBF\" d=\"M88.626,99.059c0-1.322,1.072-2.396,2.396-2.396c1.318,0,2.393,1.07,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M93.414,99.059c0,1.32-1.072,2.393-2.393,2.393c-1.322,0-2.396-1.07-2.396-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"91.022\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f13\" data-pin=\"~f13\">\n        <path fill=\"#BFBFBF\" d=\"M95.826,70.256c0-1.32,1.072-2.395,2.396-2.395c1.322,0,2.393,1.07,2.393,2.395\" />\n        <path fill=\"#E6E6E6\" d=\"M100.614,70.256c0,1.322-1.069,2.396-2.393,2.396s-2.396-1.072-2.396-2.396\" />\n        <circle fill=\"#383838\" cx=\"98.221\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g13\" data-pin=\"~g13\">\n        <path fill=\"#BFBFBF\" d=\"M95.826,77.457c0-1.322,1.072-2.396,2.396-2.396c1.322,0,2.393,1.072,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M100.614,77.457c0,1.32-1.069,2.395-2.393,2.395s-2.396-1.07-2.396-2.395\" />\n        <circle fill=\"#383838\" cx=\"98.221\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h13\" data-pin=\"~h13\">\n        <path fill=\"#BFBFBF\" d=\"M95.826,84.657c0-1.322,1.072-2.394,2.396-2.394c1.322,0,2.393,1.069,2.393,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M100.614,84.657c0,1.321-1.069,2.395-2.393,2.395s-2.396-1.071-2.396-2.395l0,0\" />\n        <circle fill=\"#383838\" cx=\"98.221\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i13\" data-pin=\"~i13\">\n        <path fill=\"#BFBFBF\" d=\"M95.826,91.857c0-1.321,1.072-2.396,2.396-2.396c1.322,0,2.393,1.072,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M100.614,91.857c0,1.319-1.069,2.394-2.393,2.394s-2.396-1.071-2.396-2.394\" />\n        <circle fill=\"#383838\" cx=\"98.221\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j13\" data-pin=\"~j13\">\n        <path fill=\"#BFBFBF\" d=\"M95.826,99.059c0-1.322,1.072-2.396,2.396-2.396c1.322,0,2.393,1.07,2.393,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M100.614,99.059c0,1.32-1.069,2.393-2.393,2.393s-2.396-1.07-2.396-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"98.221\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f14\" data-pin=\"~f14\">\n        <path fill=\"#BFBFBF\" d=\"M103.028,70.256c0-1.32,1.07-2.395,2.394-2.395c1.322,0,2.396,1.07,2.396,2.395\" />\n        <path fill=\"#E6E6E6\" d=\"M107.815,70.256c0,1.322-1.071,2.396-2.396,2.396c-1.322,0-2.394-1.072-2.394-2.396\" />\n        <circle fill=\"#383838\" cx=\"105.419\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g14\" data-pin=\"~g14\">\n        <path fill=\"#BFBFBF\" d=\"M103.028,77.457c0-1.322,1.07-2.396,2.394-2.396c1.322,0,2.396,1.072,2.396,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M107.815,77.457c0,1.32-1.071,2.395-2.396,2.395c-1.322,0-2.394-1.07-2.394-2.395\" />\n        <circle fill=\"#383838\" cx=\"105.419\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h14\" data-pin=\"~h14\">\n        <path fill=\"#BFBFBF\" d=\"M103.028,84.657c0-1.322,1.07-2.394,2.394-2.394c1.322,0,2.396,1.069,2.396,2.394\" />\n        <path fill=\"#E6E6E6\" d=\"M107.815,84.657c0,1.321-1.071,2.395-2.396,2.395c-1.322,0-2.394-1.071-2.394-2.395l0,0\" />\n        <circle fill=\"#383838\" cx=\"105.419\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i14\" data-pin=\"~i14\">\n        <path fill=\"#BFBFBF\" d=\"M103.028,91.857c0-1.321,1.07-2.396,2.394-2.396c1.322,0,2.396,1.072,2.396,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M107.815,91.857c0,1.319-1.071,2.394-2.396,2.394c-1.322,0-2.394-1.071-2.394-2.394\" />\n        <circle fill=\"#383838\" cx=\"105.419\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j14\" data-pin=\"~j14\">\n        <path fill=\"#BFBFBF\" d=\"M103.028,99.059c0-1.322,1.07-2.396,2.394-2.396c1.322,0,2.396,1.07,2.396,2.396\" />\n        <path fill=\"#E6E6E6\" d=\"M107.815,99.059c0,1.32-1.071,2.393-2.396,2.393c-1.322,0-2.394-1.07-2.394-2.393l0,0\" />\n        <circle fill=\"#383838\" cx=\"105.419\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f15\" data-pin=\"~f15\">\n        <path fill=\"#BFBFBF\" d=\"M110.227,70.256c0.002-1.32,1.075-2.392,2.397-2.39c1.317,0.003,2.387,1.069,2.39,2.39\" />\n        <path fill=\"#E6E6E6\" d=\"M115.014,70.256c0.002,1.322-1.068,2.396-2.39,2.396c-1.322,0.003-2.396-1.066-2.397-2.391 c0-0.002,0-0.004,0-0.008\" />\n        <circle fill=\"#383838\" cx=\"112.621\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g15\" data-pin=\"~g15\">\n        <path fill=\"#BFBFBF\" d=\"M110.227,77.457c0.002-1.322,1.075-2.395,2.397-2.393c1.317,0.002,2.387,1.07,2.39,2.393\" />\n        <path fill=\"#E6E6E6\" d=\"M115.014,77.457c0.002,1.32-1.068,2.396-2.39,2.396c-1.322,0.002-2.396-1.067-2.397-2.392 c0-0.002,0-0.004,0-0.006\" />\n        <circle fill=\"#383838\" cx=\"112.621\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h15\" data-pin=\"~h15\">\n        <path fill=\"#BFBFBF\" d=\"M110.227,84.657c0.002-1.322,1.075-2.394,2.397-2.392c1.317,0.002,2.387,1.071,2.39,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M115.014,84.657c0.002,1.321-1.068,2.395-2.39,2.396c-1.322,0.002-2.396-1.064-2.397-2.389 c0-0.002,0-0.007,0-0.01\" />\n        <circle fill=\"#383838\" cx=\"112.621\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i15\" data-pin=\"~i15\">\n        <path fill=\"#BFBFBF\" d=\"M110.227,91.857c0.002-1.321,1.075-2.394,2.397-2.392c1.317,0.002,2.387,1.07,2.39,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M115.014,91.857c0.002,1.319-1.068,2.396-2.39,2.396c-1.322,0.002-2.396-1.066-2.397-2.393 c0-0.002,0-0.004,0-0.006\" />\n        <circle fill=\"#383838\" cx=\"112.621\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j15\" data-pin=\"~j15\">\n        <path fill=\"#BFBFBF\" d=\"M110.227,99.059c0.002-1.322,1.075-2.395,2.397-2.393c1.317,0.002,2.387,1.068,2.39,2.393\" />\n        <path fill=\"#E6E6E6\" d=\"M115.014,99.059c0.002,1.32-1.068,2.395-2.39,2.396c-1.322,0.002-2.396-1.068-2.397-2.39 c0-0.004,0-0.006,0-0.008\" />\n        <circle fill=\"#383838\" cx=\"112.621\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f16\" data-pin=\"~f16\">\n        <path fill=\"#BFBFBF\" d=\"M117.428,70.256c0.003-1.32,1.073-2.392,2.396-2.39c1.318,0.003,2.389,1.069,2.391,2.39\" />\n        <path fill=\"#E6E6E6\" d=\"M122.214,70.256c0.002,1.322-1.066,2.396-2.391,2.396c-1.324,0.002-2.395-1.066-2.396-2.391 c0-0.002,0-0.004,0-0.008\" />\n        <circle fill=\"#383838\" cx=\"119.821\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g16\" data-pin=\"~g16\">\n        <path fill=\"#BFBFBF\" d=\"M117.428,77.457c0.003-1.322,1.073-2.395,2.396-2.393c1.318,0.002,2.389,1.07,2.391,2.393\" />\n        <path fill=\"#E6E6E6\" d=\"M122.214,77.457c0.002,1.32-1.066,2.396-2.391,2.396c-1.322,0.002-2.395-1.067-2.396-2.392 c0-0.002,0-0.004,0-0.006\" />\n        <circle fill=\"#383838\" cx=\"119.821\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h16\" data-pin=\"~h16\">\n        <path fill=\"#BFBFBF\" d=\"M117.428,84.657c0.003-1.322,1.073-2.394,2.396-2.392c1.318,0.002,2.389,1.071,2.391,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M122.214,84.657c0.002,1.321-1.066,2.395-2.391,2.396c-1.324,0.002-2.395-1.064-2.396-2.389 c0-0.002,0-0.007,0-0.01\" />\n        <circle fill=\"#383838\" cx=\"119.821\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i16\" data-pin=\"~i16\">\n        <path fill=\"#BFBFBF\" d=\"M117.428,91.857c0.003-1.321,1.073-2.394,2.396-2.392c1.318,0.002,2.389,1.07,2.391,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M122.214,91.857c0.002,1.319-1.066,2.396-2.391,2.396s-2.395-1.066-2.396-2.393c0-0.002,0-0.004,0-0.006\" />\n        <circle fill=\"#383838\" cx=\"119.821\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j16\" data-pin=\"~j16\">\n        <path fill=\"#BFBFBF\" d=\"M117.428,99.059c0.003-1.322,1.073-2.395,2.396-2.393c1.318,0.002,2.389,1.068,2.391,2.393\" />\n        <path fill=\"#E6E6E6\" d=\"M122.214,99.059c0.002,1.32-1.066,2.395-2.391,2.396s-2.395-1.068-2.396-2.39c0-0.004,0-0.006,0-0.008\" />\n        <circle fill=\"#383838\" cx=\"119.821\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n      <g id=\"~f17\" data-pin=\"~f17\">\n        <path fill=\"#BFBFBF\" d=\"M124.626,70.256c0.002-1.32,1.074-2.392,2.396-2.39c1.318,0.003,2.389,1.069,2.391,2.39\" />\n        <path fill=\"#E6E6E6\" d=\"M129.414,70.256c0.002,1.322-1.067,2.396-2.392,2.396c-1.321,0.003-2.396-1.066-2.396-2.391 c0-0.002,0-0.004,0-0.008\" />\n        <circle fill=\"#383838\" cx=\"127.02\" cy=\"70.257\" r=\"1.196\" />\n      </g>\n      <g id=\"~g17\" data-pin=\"~g17\">\n        <path fill=\"#BFBFBF\" d=\"M124.626,77.457c0.002-1.322,1.074-2.395,2.396-2.393c1.318,0.002,2.389,1.07,2.391,2.393\" />\n        <path fill=\"#E6E6E6\" d=\"M129.414,77.457c0.002,1.32-1.067,2.396-2.392,2.396c-1.321,0.002-2.396-1.067-2.396-2.392 c0-0.002,0-0.004,0-0.006\" />\n        <circle fill=\"#383838\" cx=\"127.02\" cy=\"77.456\" r=\"1.196\" />\n      </g>\n      <g id=\"~h17\" data-pin=\"~h17\">\n        <path fill=\"#BFBFBF\" d=\"M124.626,84.657c0.002-1.322,1.074-2.394,2.396-2.392c1.318,0.002,2.389,1.071,2.391,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M129.414,84.657c0.002,1.321-1.067,2.395-2.392,2.396c-1.321,0.002-2.396-1.064-2.396-2.389 c0-0.002,0-0.007,0-0.01\" />\n        <circle fill=\"#383838\" cx=\"127.02\" cy=\"84.657\" r=\"1.197\" />\n      </g>\n      <g id=\"~i17\" data-pin=\"~i17\">\n        <path fill=\"#BFBFBF\" d=\"M124.626,91.857c0.002-1.321,1.074-2.394,2.396-2.392c1.318,0.002,2.389,1.07,2.391,2.392\" />\n        <path fill=\"#E6E6E6\" d=\"M129.414,91.857c0.002,1.319-1.067,2.396-2.392,2.396c-1.321,0.002-2.396-1.066-2.396-2.393 c0-0.002,0-0.004,0-0.006\" />\n        <circle fill=\"#383838\" cx=\"127.02\" cy=\"91.857\" r=\"1.196\" />\n      </g>\n      <g id=\"~j17\" data-pin=\"~j17\">\n        <path fill=\"#BFBFBF\" d=\"M124.626,99.059c0.002-1.322,1.074-2.395,2.396-2.393c1.318,0.002,2.389,1.068,2.391,2.393\" />\n        <path fill=\"#E6E6E6\" d=\"M129.414,99.059c0.002,1.32-1.067,2.395-2.392,2.396c-1.321,0.002-2.396-1.068-2.396-2.39 c0-0.004,0-0.006,0-0.008\" />\n        <circle fill=\"#383838\" cx=\"127.02\" cy=\"99.057\" r=\"1.197\" />\n      </g>\n    </g>\n  </g>\n</svg>";

    /* src/breadboard.svelte generated by Svelte v3.19.2 */

    const { console: console_1 } = globals;
    const file$3 = "src/breadboard.svelte";

    function create_fragment$3(ctx) {
    	let div1;
    	let div0;
    	let breadboard_action;
    	let dispose;

    	const block = {
    		c: function create() {
    			div1 = element("div");
    			div0 = element("div");
    			attr_dev(div0, "id", "canvas");
    			attr_dev(div0, "class", "svelte-1mu5pts");
    			add_location(div0, file$3, 26, 2, 508);
    			add_location(div1, file$3, 25, 0, 500);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div1, anchor);
    			append_dev(div1, div0);
    			dispose = action_destroyer(breadboard_action = breadboard.call(null, div0));
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div1);
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$3.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function breadboard(node) {
    	const draw = SVG().addTo(node).size("100%", "100%");

    	draw.on("mouseover mouseout", ev => {
    		const parent = ev.target.parentNode;

    		if (parent.dataset && parent.dataset.pin) {
    			console.log("pin", parent.dataset.pin);
    		}
    	});

    	draw.svg(BB);
    }

    function instance$3($$self, $$props, $$invalidate) {
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console_1.warn(`<Breadboard> was created with unknown prop '${key}'`);
    	});

    	let { $$slots = {}, $$scope } = $$props;
    	validate_slots("Breadboard", $$slots, []);
    	$$self.$capture_state = () => ({ SVG, BB, breadboard });
    	return [];
    }

    class Breadboard extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$3, create_fragment$3, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Breadboard",
    			options,
    			id: create_fragment$3.name
    		});
    	}
    }

    /* src/app.svelte generated by Svelte v3.19.2 */

    const { console: console_1$1 } = globals;
    const file$4 = "src/app.svelte";

    function get_each_context$1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[16] = list[i];
    	return child_ctx;
    }

    // (130:2) {#if error}
    function create_if_block(ctx) {
    	let div;
    	let t;

    	const block = {
    		c: function create() {
    			div = element("div");
    			t = text(/*error*/ ctx[3]);
    			attr_dev(div, "class", "notification is-danger");
    			add_location(div, file$4, 130, 4, 2689);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, t);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*error*/ 8) set_data_dev(t, /*error*/ ctx[3]);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block.name,
    		type: "if",
    		source: "(130:2) {#if error}",
    		ctx
    	});

    	return block;
    }

    // (177:18) {#each ports as port}
    function create_each_block$1(ctx) {
    	let option;
    	let t_value = /*port*/ ctx[16] + "";
    	let t;
    	let option_value_value;

    	const block = {
    		c: function create() {
    			option = element("option");
    			t = text(t_value);
    			option.__value = option_value_value = /*port*/ ctx[16];
    			option.value = option.__value;
    			add_location(option, file$4, 177, 20, 4246);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, option, anchor);
    			append_dev(option, t);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*ports*/ 4 && t_value !== (t_value = /*port*/ ctx[16] + "")) set_data_dev(t, t_value);

    			if (dirty & /*ports*/ 4 && option_value_value !== (option_value_value = /*port*/ ctx[16])) {
    				prop_dev(option, "__value", option_value_value);
    			}

    			option.value = option.__value;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(option);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block$1.name,
    		type: "each",
    		source: "(177:18) {#each ports as port}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$4(ctx) {
    	let div0;
    	let t0;
    	let div11;
    	let nav;
    	let div2;
    	let div1;
    	let span2;
    	let span0;
    	let t1;
    	let span1;
    	let t3;
    	let sup;
    	let t4;
    	let t5;
    	let button0;
    	let span3;
    	let t6;
    	let span4;
    	let t7;
    	let span5;
    	let t8;
    	let div9;
    	let div3;
    	let t9;
    	let div8;
    	let div7;
    	let div6;
    	let p0;
    	let button1;
    	let span6;
    	let t10;
    	let div5;
    	let div4;
    	let select;
    	let select_disabled_value;
    	let t11;
    	let p1;
    	let input;
    	let input_disabled_value;
    	let t12;
    	let p2;
    	let button2;
    	let t13_value = (/*connected*/ ctx[6] ? "Disconnect" : "Connect") + "";
    	let t13;
    	let t14;
    	let div10;
    	let current;
    	let dispose;
    	let if_block = /*error*/ ctx[3] && create_if_block(ctx);
    	const radioicon = new RadioIcon({ $$inline: true });
    	const refreshcwicon = new RefreshCwIcon({ $$inline: true });
    	let each_value = /*ports*/ ctx[2];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
    	}

    	const breadboard = new Breadboard({ $$inline: true });

    	const block = {
    		c: function create() {
    			div0 = element("div");
    			if (if_block) if_block.c();
    			t0 = space();
    			div11 = element("div");
    			nav = element("nav");
    			div2 = element("div");
    			div1 = element("div");
    			span2 = element("span");
    			span0 = element("span");
    			create_component(radioicon.$$.fragment);
    			t1 = space();
    			span1 = element("span");
    			span1.textContent = "FPGB";
    			t3 = space();
    			sup = element("sup");
    			t4 = text(/*version*/ ctx[4]);
    			t5 = space();
    			button0 = element("button");
    			span3 = element("span");
    			t6 = space();
    			span4 = element("span");
    			t7 = space();
    			span5 = element("span");
    			t8 = space();
    			div9 = element("div");
    			div3 = element("div");
    			t9 = space();
    			div8 = element("div");
    			div7 = element("div");
    			div6 = element("div");
    			p0 = element("p");
    			button1 = element("button");
    			span6 = element("span");
    			create_component(refreshcwicon.$$.fragment);
    			t10 = space();
    			div5 = element("div");
    			div4 = element("div");
    			select = element("select");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t11 = space();
    			p1 = element("p");
    			input = element("input");
    			t12 = space();
    			p2 = element("p");
    			button2 = element("button");
    			t13 = text(t13_value);
    			t14 = space();
    			div10 = element("div");
    			create_component(breadboard.$$.fragment);
    			attr_dev(div0, "class", "notification-container svelte-6e43oh");
    			add_location(div0, file$4, 128, 0, 2634);
    			attr_dev(span0, "class", "icon is-small");
    			add_location(span0, file$4, 139, 10, 2926);
    			attr_dev(span1, "class", "is-size-4 has-text-weight-bold is-family-code");
    			add_location(span1, file$4, 142, 10, 3009);
    			attr_dev(sup, "class", "is-size-7 is-family-code");
    			add_location(sup, file$4, 145, 10, 3115);
    			toggle_class(span2, "is-danger", /*connected*/ ctx[6]);
    			add_location(span2, file$4, 138, 8, 2881);
    			attr_dev(div1, "class", "navbar-item");
    			add_location(div1, file$4, 137, 6, 2847);
    			attr_dev(span3, "aria-hidden", "true");
    			add_location(span3, file$4, 153, 8, 3374);
    			attr_dev(span4, "aria-hidden", "true");
    			add_location(span4, file$4, 154, 8, 3410);
    			attr_dev(span5, "aria-hidden", "true");
    			add_location(span5, file$4, 155, 8, 3446);
    			attr_dev(button0, "class", "navbar-burger burger has-background-dark svelte-6e43oh");
    			attr_dev(button0, "aria-hidden", "true");
    			toggle_class(button0, "is-active", /*navbarOpen*/ ctx[7]);
    			add_location(button0, file$4, 148, 6, 3204);
    			attr_dev(div2, "class", "navbar-brand");
    			add_location(div2, file$4, 136, 4, 2814);
    			attr_dev(div3, "class", "navbar-start");
    			add_location(div3, file$4, 159, 6, 3586);
    			attr_dev(span6, "class", "icon is-small");
    			add_location(span6, file$4, 168, 16, 3902);
    			attr_dev(button1, "class", "button is-small svelte-6e43oh");
    			attr_dev(button1, "title", "Reload");
    			add_location(button1, file$4, 164, 14, 3767);
    			attr_dev(p0, "class", "control");
    			add_location(p0, file$4, 163, 12, 3733);
    			select.disabled = select_disabled_value = /*busy*/ ctx[5] || /*connected*/ ctx[6];
    			if (/*portName*/ ctx[1] === void 0) add_render_callback(() => /*select_change_handler*/ ctx[14].call(select));
    			add_location(select, file$4, 175, 16, 4126);
    			attr_dev(div4, "class", "select is-small");
    			add_location(div4, file$4, 174, 14, 4080);
    			attr_dev(div5, "class", "control");
    			add_location(div5, file$4, 173, 12, 4044);
    			attr_dev(input, "class", "input is-small svelte-6e43oh");
    			attr_dev(input, "type", "text");
    			attr_dev(input, "placeholder", "Baudrate");
    			input.disabled = input_disabled_value = /*busy*/ ctx[5] || /*connected*/ ctx[6];
    			add_location(input, file$4, 183, 14, 4421);
    			attr_dev(p1, "class", "control");
    			add_location(p1, file$4, 182, 12, 4387);
    			attr_dev(button2, "class", "button is-small svelte-6e43oh");
    			button2.disabled = /*busy*/ ctx[5];
    			toggle_class(button2, "is-loading", /*busy*/ ctx[5]);
    			toggle_class(button2, "is-primary", !/*connected*/ ctx[6]);
    			toggle_class(button2, "is-danger", /*connected*/ ctx[6]);
    			add_location(button2, file$4, 191, 14, 4683);
    			attr_dev(p2, "class", "control");
    			add_location(p2, file$4, 190, 12, 4649);
    			attr_dev(div6, "class", "field has-addons");
    			add_location(div6, file$4, 162, 10, 3690);
    			attr_dev(div7, "class", "navbar-item");
    			add_location(div7, file$4, 161, 8, 3654);
    			attr_dev(div8, "class", "navbar-end");
    			add_location(div8, file$4, 160, 6, 3621);
    			attr_dev(div9, "class", "navbar-menu has-background-dark");
    			toggle_class(div9, "is-active", /*navbarOpen*/ ctx[7]);
    			add_location(div9, file$4, 158, 4, 3505);
    			attr_dev(nav, "class", "navbar is-dark");
    			add_location(nav, file$4, 135, 2, 2781);
    			add_location(div10, file$4, 206, 2, 5101);
    			attr_dev(div11, "class", "workspace svelte-6e43oh");
    			add_location(div11, file$4, 134, 0, 2755);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div0, anchor);
    			if (if_block) if_block.m(div0, null);
    			insert_dev(target, t0, anchor);
    			insert_dev(target, div11, anchor);
    			append_dev(div11, nav);
    			append_dev(nav, div2);
    			append_dev(div2, div1);
    			append_dev(div1, span2);
    			append_dev(span2, span0);
    			mount_component(radioicon, span0, null);
    			append_dev(span2, t1);
    			append_dev(span2, span1);
    			append_dev(span2, t3);
    			append_dev(span2, sup);
    			append_dev(sup, t4);
    			append_dev(div2, t5);
    			append_dev(div2, button0);
    			append_dev(button0, span3);
    			append_dev(button0, t6);
    			append_dev(button0, span4);
    			append_dev(button0, t7);
    			append_dev(button0, span5);
    			append_dev(nav, t8);
    			append_dev(nav, div9);
    			append_dev(div9, div3);
    			append_dev(div9, t9);
    			append_dev(div9, div8);
    			append_dev(div8, div7);
    			append_dev(div7, div6);
    			append_dev(div6, p0);
    			append_dev(p0, button1);
    			append_dev(button1, span6);
    			mount_component(refreshcwicon, span6, null);
    			append_dev(div6, t10);
    			append_dev(div6, div5);
    			append_dev(div5, div4);
    			append_dev(div4, select);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(select, null);
    			}

    			select_option(select, /*portName*/ ctx[1]);
    			append_dev(div6, t11);
    			append_dev(div6, p1);
    			append_dev(p1, input);
    			set_input_value(input, /*baudrate*/ ctx[0]);
    			append_dev(div6, t12);
    			append_dev(div6, p2);
    			append_dev(p2, button2);
    			append_dev(button2, t13);
    			append_dev(div11, t14);
    			append_dev(div11, div10);
    			mount_component(breadboard, div10, null);
    			current = true;

    			dispose = [
    				listen_dev(button0, "click", /*toggleNavbar*/ ctx[10], false, false, false),
    				listen_dev(button1, "click", /*reloadPorts*/ ctx[8], false, false, false),
    				listen_dev(select, "change", /*select_change_handler*/ ctx[14]),
    				listen_dev(input, "input", /*input_input_handler*/ ctx[15]),
    				listen_dev(button2, "click", /*toggleConnection*/ ctx[9], false, false, false)
    			];
    		},
    		p: function update(ctx, [dirty]) {
    			if (/*error*/ ctx[3]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					if_block.m(div0, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (!current || dirty & /*version*/ 16) set_data_dev(t4, /*version*/ ctx[4]);

    			if (dirty & /*connected*/ 64) {
    				toggle_class(span2, "is-danger", /*connected*/ ctx[6]);
    			}

    			if (dirty & /*navbarOpen*/ 128) {
    				toggle_class(button0, "is-active", /*navbarOpen*/ ctx[7]);
    			}

    			if (dirty & /*ports*/ 4) {
    				each_value = /*ports*/ ctx[2];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$1(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$1(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(select, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (!current || dirty & /*busy, connected*/ 96 && select_disabled_value !== (select_disabled_value = /*busy*/ ctx[5] || /*connected*/ ctx[6])) {
    				prop_dev(select, "disabled", select_disabled_value);
    			}

    			if (dirty & /*portName*/ 2) {
    				select_option(select, /*portName*/ ctx[1]);
    			}

    			if (!current || dirty & /*busy, connected*/ 96 && input_disabled_value !== (input_disabled_value = /*busy*/ ctx[5] || /*connected*/ ctx[6])) {
    				prop_dev(input, "disabled", input_disabled_value);
    			}

    			if (dirty & /*baudrate*/ 1 && input.value !== /*baudrate*/ ctx[0]) {
    				set_input_value(input, /*baudrate*/ ctx[0]);
    			}

    			if ((!current || dirty & /*connected*/ 64) && t13_value !== (t13_value = (/*connected*/ ctx[6] ? "Disconnect" : "Connect") + "")) set_data_dev(t13, t13_value);

    			if (!current || dirty & /*busy*/ 32) {
    				prop_dev(button2, "disabled", /*busy*/ ctx[5]);
    			}

    			if (dirty & /*busy*/ 32) {
    				toggle_class(button2, "is-loading", /*busy*/ ctx[5]);
    			}

    			if (dirty & /*connected*/ 64) {
    				toggle_class(button2, "is-primary", !/*connected*/ ctx[6]);
    			}

    			if (dirty & /*connected*/ 64) {
    				toggle_class(button2, "is-danger", /*connected*/ ctx[6]);
    			}

    			if (dirty & /*navbarOpen*/ 128) {
    				toggle_class(div9, "is-active", /*navbarOpen*/ ctx[7]);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(radioicon.$$.fragment, local);
    			transition_in(refreshcwicon.$$.fragment, local);
    			transition_in(breadboard.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(radioicon.$$.fragment, local);
    			transition_out(refreshcwicon.$$.fragment, local);
    			transition_out(breadboard.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div0);
    			if (if_block) if_block.d();
    			if (detaching) detach_dev(t0);
    			if (detaching) detach_dev(div11);
    			destroy_component(radioicon);
    			destroy_component(refreshcwicon);
    			destroy_each(each_blocks, detaching);
    			destroy_component(breadboard);
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$4.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function serialHook(buffer) {
    	new TextDecoder("utf-8").decode(buffer).split("\n").map(console.log);
    }

    function instance$4($$self, $$props, $$invalidate) {
    	const connection = new WebSocket(`ws://${window.location.host}/ws`);
    	let baudrate = 19200;
    	let portName;
    	let ports = [];
    	let error = "";
    	let version = "";
    	let busy = false;
    	let connected = false;
    	let navbarOpen = false;

    	onMount(async () => {
    		connection.onopen = onBridgeOpen;

    		connection.onclose = () => {
    			$$invalidate(6, connected = false);
    			$$invalidate(3, error = "");
    		};

    		connection.onmessage = onMessage;
    	});

    	async function onMessage({ data }) {
    		if (typeof data === "object") {
    			const reader = new FileReader();
    			reader.addEventListener("loadend", () => serialHook(new Uint8Array(reader.result)));
    			reader.readAsArrayBuffer(data);
    			return;
    		}

    		const [command, ...params] = data.split(" ");

    		switch (command) {
    			case "INIT:":
    				{
    					$$invalidate(4, version = params[1] || "N/A");
    					break;
    				}
    			case "STATUS:":
    				{
    					$$invalidate(3, error = "");
    					$$invalidate(6, connected = params[0] === "UP");

    					if (connected) {
    						$$invalidate(7, navbarOpen = false);
    					}

    					break;
    				}
    			case "ERROR:":
    				{
    					$$invalidate(3, error = params.join(" "));
    					break;
    				}
    			case "LIST:":
    				{
    					$$invalidate(1, portName = params[0]);
    					$$invalidate(2, ports = params);
    					break;
    				}
    		}

    		$$invalidate(5, busy = false);
    	}

    	function onBridgeOpen() {
    		connection.send("INIT");
    	}

    	function reloadPorts() {
    		connection.send("LIST");
    	}

    	function toggleConnection() {
    		if (connection.readyState !== 1) {
    			$$invalidate(3, error = "Websocket disconnected");
    			return;
    		}

    		$$invalidate(5, busy = true);
    		$$invalidate(3, error = "");

    		connected
    		? connection.send("DISCONNECT")
    		: connection.send(`CONNECT ${portName} ${baudrate}`);
    	}

    	function toggleNavbar() {
    		$$invalidate(7, navbarOpen = !navbarOpen);
    	}

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console_1$1.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	let { $$slots = {}, $$scope } = $$props;
    	validate_slots("App", $$slots, []);

    	function select_change_handler() {
    		portName = select_value(this);
    		$$invalidate(1, portName);
    		$$invalidate(2, ports);
    	}

    	function input_input_handler() {
    		baudrate = this.value;
    		$$invalidate(0, baudrate);
    	}

    	$$self.$capture_state = () => ({
    		onMount,
    		RadioIcon,
    		RefreshCwIcon,
    		Chart,
    		Breadboard,
    		connection,
    		baudrate,
    		portName,
    		ports,
    		error,
    		version,
    		busy,
    		connected,
    		navbarOpen,
    		onMessage,
    		onBridgeOpen,
    		reloadPorts,
    		toggleConnection,
    		toggleNavbar,
    		serialHook
    	});

    	$$self.$inject_state = $$props => {
    		if ("baudrate" in $$props) $$invalidate(0, baudrate = $$props.baudrate);
    		if ("portName" in $$props) $$invalidate(1, portName = $$props.portName);
    		if ("ports" in $$props) $$invalidate(2, ports = $$props.ports);
    		if ("error" in $$props) $$invalidate(3, error = $$props.error);
    		if ("version" in $$props) $$invalidate(4, version = $$props.version);
    		if ("busy" in $$props) $$invalidate(5, busy = $$props.busy);
    		if ("connected" in $$props) $$invalidate(6, connected = $$props.connected);
    		if ("navbarOpen" in $$props) $$invalidate(7, navbarOpen = $$props.navbarOpen);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [
    		baudrate,
    		portName,
    		ports,
    		error,
    		version,
    		busy,
    		connected,
    		navbarOpen,
    		reloadPorts,
    		toggleConnection,
    		toggleNavbar,
    		connection,
    		onMessage,
    		onBridgeOpen,
    		select_change_handler,
    		input_input_handler
    	];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$4, create_fragment$4, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment$4.name
    		});
    	}
    }

    const app = new App({ target: document.body });

    return app;

}());
//# sourceMappingURL=app.js.map
