/**
 * CriticMarkup plugin for markdown-it
 *
 * Parses CriticMarkup syntax and renders as styled HTML:
 *   {++addition++}       -> green underlined text
 *   {--deletion--}       -> red strikethrough text
 *   {~~old~>new~~}       -> substitution (deletion + addition)
 *   {>>comment<<}        -> comment marker + sidebar card
 *   {==highlight==}      -> yellow highlighted text
 */
(function () {
  'use strict';

  const RE_SUBSTITUTION = /^\{~~([\s\S]+?)~>([\s\S]+?)~~\}/;
  const RE_ADDITION     = /^\{\+\+([\s\S]+?)\+\+\}/;
  const RE_DELETION     = /^\{--([\s\S]+?)--\}/;
  const RE_COMMENT      = /^\{>>([\s\S]+?)<<\}/;
  const RE_HIGHLIGHT    = /^\{==([\s\S]+?)==\}/;

  function escapeDataAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.criticmarkupPlugin = function criticmarkupPlugin(md) {

    function criticRule(state, silent) {
      if (state.src.charCodeAt(state.pos) !== 0x7B) return false;

      const remaining = state.src.slice(state.pos);
      let match;

      // Try substitution first (before deletion, since both use special chars)
      if ((match = remaining.match(RE_SUBSTITUTION))) {
        if (silent) return true;
        const token = state.push('critic_substitution', '', 0);
        token.meta = { old: match[1], new: match[2], offset: state.pos };
        token.markup = match[0];
        state.pos += match[0].length;
        return true;
      }

      if ((match = remaining.match(RE_ADDITION))) {
        if (silent) return true;
        const token = state.push('critic_addition', '', 0);
        token.meta = { content: match[1], offset: state.pos };
        token.markup = match[0];
        state.pos += match[0].length;
        return true;
      }

      if ((match = remaining.match(RE_DELETION))) {
        if (silent) return true;
        const token = state.push('critic_deletion', '', 0);
        token.meta = { content: match[1], offset: state.pos };
        token.markup = match[0];
        state.pos += match[0].length;
        return true;
      }

      if ((match = remaining.match(RE_COMMENT))) {
        if (silent) return true;
        const token = state.push('critic_comment', '', 0);
        token.meta = { content: match[1], offset: state.pos };
        token.markup = match[0];
        state.pos += match[0].length;
        return true;
      }

      if ((match = remaining.match(RE_HIGHLIGHT))) {
        if (silent) return true;
        const token = state.push('critic_highlight', '', 0);
        token.meta = { content: match[1], offset: state.pos };
        token.markup = match[0];
        state.pos += match[0].length;
        return true;
      }

      return false;
    }

    md.inline.ruler.before('emphasis', 'critic', criticRule);

    // --- Render Rules ---

    md.renderer.rules.critic_addition = function (tokens, idx) {
      const meta = tokens[idx].meta;
      const markup = escapeDataAttr(tokens[idx].markup);
      const rendered = md.renderInline(meta.content);
      return '<span class="critic-addition" data-markup="' + markup + '" data-offset="' + meta.offset + '">'
        + rendered
        + '<span class="critic-controls">'
        + '<button class="critic-accept" title="Accept addition">&#10003;</button>'
        + '<button class="critic-reject" title="Reject addition">&#10005;</button>'
        + '</span>'
        + '</span>';
    };

    md.renderer.rules.critic_deletion = function (tokens, idx) {
      const meta = tokens[idx].meta;
      const markup = escapeDataAttr(tokens[idx].markup);
      const text = md.utils.escapeHtml(meta.content);
      return '<span class="critic-deletion" data-markup="' + markup + '" data-offset="' + meta.offset + '">'
        + text
        + '<span class="critic-controls">'
        + '<button class="critic-accept" title="Accept deletion">&#10003;</button>'
        + '<button class="critic-reject" title="Reject deletion">&#10005;</button>'
        + '</span>'
        + '</span>';
    };

    md.renderer.rules.critic_substitution = function (tokens, idx) {
      const meta = tokens[idx].meta;
      const markup = escapeDataAttr(tokens[idx].markup);
      const oldText = md.utils.escapeHtml(meta.old);
      const newText = md.renderInline(meta.new);
      return '<span class="critic-substitution" data-markup="' + markup + '" data-offset="' + meta.offset + '">'
        + '<span class="critic-deletion">' + oldText + '</span>'
        + '<span class="critic-addition">' + newText + '</span>'
        + '<span class="critic-controls">'
        + '<button class="critic-accept" title="Accept change">&#10003;</button>'
        + '<button class="critic-reject" title="Reject change">&#10005;</button>'
        + '</span>'
        + '</span>';
    };

    md.renderer.rules.critic_comment = function (tokens, idx) {
      const meta = tokens[idx].meta;
      const markup = escapeDataAttr(tokens[idx].markup);
      const text = md.utils.escapeHtml(meta.content);
      return '<span class="critic-comment-marker" data-markup="' + markup + '" data-offset="' + meta.offset + '" data-comment-text="' + escapeDataAttr(meta.content) + '">'
        + '<span class="critic-controls">'
        + '<button class="critic-accept" title="Remove comment">&#10003;</button>'
        + '<button class="critic-reject" title="Remove comment">&#10005;</button>'
        + '</span>'
        + '</span>';
    };

    md.renderer.rules.critic_highlight = function (tokens, idx) {
      const meta = tokens[idx].meta;
      const markup = escapeDataAttr(tokens[idx].markup);
      const rendered = md.renderInline(meta.content);
      return '<span class="critic-highlight" data-markup="' + markup + '" data-offset="' + meta.offset + '">'
        + rendered
        + '<span class="critic-controls">'
        + '<button class="critic-accept" title="Accept highlight">&#10003;</button>'
        + '<button class="critic-reject" title="Reject highlight">&#10005;</button>'
        + '</span>'
        + '</span>';
    };
  };
})();
