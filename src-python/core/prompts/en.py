"""English prompt templates.

All text injected into LLM prompts for English-language users.
Routed by core.prompts based on app.language.
"""

# ===========================================================================
# context_assembler.py: build_system_prompt
# ===========================================================================

SYSTEM_NOVELIST = "You are a professional fiction writer."

PINNED_CONTEXT_HEADER = (
    "# Core Narrative Rules — show through behavior, never state directly\n"
    "The following are inviolable narrative constraints. Express them through character actions, "
    "dialogue, and details (show, don't tell).\n"
    "Never write these rules as narration or inner monologue:\n"
    "{lines}"
)

CONFLICT_RESOLUTION_RULES = (
    "# Conflict Resolution Rules (Important)\n"
    'When "previous chapter ending", "retrieved historical lore" and "current plot state (fact sheet)" '
    "conflict semantically,\n"
    'you MUST use "current plot state (fact sheet)" as the sole source of truth and disregard other '
    "conflicting information.\n\n"
    'If "core narrative rules (pinned_context)" contradicts "current plot state", proceed normally.\n'
    "The system will prompt the user to update outdated rules externally."
)

PERSPECTIVE_FIRST_PERSON = (
    "# Narrative Perspective\n"
    "Write in first person from {pov}'s point of view. The 'objective facts' below describe "
    "the world state around {pov}.\n"
    "Transform them into {pov}'s subjective perception, inner thoughts, and first-person actions."
)

PERSPECTIVE_THIRD_PERSON = "# Narrative Perspective\nWrite in third-person narrative perspective."

EMOTION_EXPLICIT = "# Emotion Style\nYou may directly describe characters' inner thoughts and emotions."

EMOTION_IMPLICIT = (
    "# Emotion Style\n"
    "Prefer conveying emotions through actions and details. Avoid directly stating mental states."
)

FORESHADOWING_RULES = (
    "# Foreshadowing Rules (Important)\n"
    'Items marked "unresolved" in the current plot state are background constraints that hold true in the story world.\n'
    "Unless the instruction explicitly asks you to advance them, keep them unresolved — use only as atmospheric texture.\n"
    'Do not force-resolve any unresolved thread, and do not casually "mention" them just to acknowledge their existence.'
)

GENERIC_RULES = (
    "# General Rules\n"
    "Do not include chapter numbers or any structural markup outside the narrative.\n"
    "All background information should emerge naturally through character behavior, thoughts, and dialogue.\n"
    "Target word count for this chapter: approximately {chapter_length} words."
)

CUSTOM_INSTRUCTIONS_HEADER = "# Custom Style Instructions\n{custom}"


# ===========================================================================
# context_assembler.py: build_instruction
# ===========================================================================

CURRENT_STATUS = "## Current Status\nThis is Chapter {current_ch}."

LAST_ENDING_INLINE = "Previous chapter ended with: {last_ending}"

FOCUS_GOAL_HEADER = "## Core Advancement Goal for This Chapter (Mandatory)"

FOCUS_GOAL_DEFINITION = (
    "In this chapter, provide substantive advancement on the following threads.\n"
    '"Advancement" means: new information emerges, relationships change, or conflict escalates/moves closer to resolution.\n'
    '"Just mentioning it" or "just describing mood/atmosphere" does NOT count.\n'
    "Advancement must produce perceivable new information or state changes so the reader clearly feels "
    "the plot has moved closer to some outcome.\n"
    "If the thread shows no substantive change by chapter end, the goal is unfulfilled.\n"
    "{focus_lines}"
)

ATTENTION_HEADER = "## Special Attention (1-2 high-weight threads most likely to be triggered — do NOT advance)"

ATTENTION_BODY = (
    "The following threads are easily triggered. Exercise restraint — keep them unresolved this chapter:\n"
    "{caution_lines}"
)

BG_RULES = (
    "## Background Information Rules\n"
    'Remaining "unresolved" items in the plot state serve only as world background.\n'
    "Unless the current instruction explicitly requests it, keep them unresolved."
)

PACING_INSTRUCTION = (
    "## Chapter Pacing\n"
    "This chapter focuses on continuing the current storyline and building atmosphere.\n"
    "Unless the user's instruction explicitly requests advancing or resolving a specific event, "
    "keep all existing foreshadowing unresolved. Do not rush to resolve any thread or "
    "arbitrarily pick unresolved items to address."
)

CONTINUE_WRITING = "## Please Continue Writing\n{user_input}"


# ===========================================================================
# context_assembler.py: build_facts_layer
# ===========================================================================

SECTION_PLOT_STATE = "## Current Plot State"

UNRESOLVED_DROPPED_HINT = "({count} additional unresolved thread(s) not shown — see fact sheet)"


# ===========================================================================
# context_assembler.py: build_recent_chapter_layer
# ===========================================================================

SECTION_LAST_ENDING = "## Previous Chapter Ending\n{content}"

SECTION_LAST_ENDING_TRUNCATED = "## Previous Chapter Ending\n(earlier text omitted)…{end_text}"


# ===========================================================================
# context_assembler.py: build_core_settings_layer
# ===========================================================================

SECTION_CHARACTERS = "## Character Profiles"


# ===========================================================================
# rag_retrieval.py
# ===========================================================================

RAG_LABEL_CHARACTERS = "Character Profiles"
RAG_LABEL_WORLDBUILDING = "Worldbuilding"
RAG_LABEL_CHAPTERS = "Historical Chapter Excerpts"


# ===========================================================================
# facts_extraction.py
# ===========================================================================

FACTS_SYSTEM_PROMPT = """\
You are a professional fanfiction lore analysis assistant. Extract key plot facts and lore from the chapter text.

[Extraction Rules]

1. Merge transient processes: If an event completes within the chapter (e.g. captured→escaped, \
injured→healed), merge the entire process into one result-state fact describing the final outcome \
and key process. Do not split intermediate steps into separate facts.

2. Quantity control: Extract only 3-5 most important fact changes per chapter, never exceed 5. Prioritize:
   - Events where character relationships materially change
   - Events that plant foreshadowing or suspense (mark as unresolved)
   - Key actions and decisions
   - Newly introduced characters or factions
   Ignore:
   - Pure emotional descriptions ("he felt uneasy")
   - Environmental/atmospheric descriptions
   - Temporary states that complete within the chapter with no lasting impact

3. Only extract facts that still hold true at chapter end.

4. Character inner thoughts: Only extract when they materially affect future plot \
(e.g. "suspects X is the mastermind"). Pure emotional feelings should not be extracted.

5. Classify fact types (fact_type):
   - character_detail: traits, habits, appearance
   - relationship: changes in character relationships
   - plot_event: events that have occurred
   - foreshadowing: planted clues, unresolved mysteries
   - backstory: background stories, flashbacks
   - world_rule: world-building rules

6. Assess narrative weight (narrative_weight):
   - high: key information affecting main plot direction
   - medium: important but not decisive
   - low: atmospheric details, minor information

7. Determine status:
   - unresolved: foreshadowing/suspense not yet revealed
   - active: confirmed fact, currently valid

8. content_raw: preserve chapter references (e.g. "In Chapter N...")
9. content_clean: pure third-person objective description, remove chapter number references
10. characters: list involved character names (use main names, not aliases)

Output format: JSON array with the above fields. Output ONLY JSON, nothing else."""

FACTS_BATCH_SYSTEM_PROMPT = """\
You are a professional fanfiction lore analysis assistant. Extract key plot facts from the following \
consecutive chapters.

[Extraction Rules]

1. Merge transient processes: If an event completes within a chapter (e.g. captured→escaped), \
merge into one result-state fact. Do not split intermediate steps.

2. Cross-chapter events: If an event spans multiple chapters (e.g. starts Ch.3, ends Ch.5), \
extract one result-state fact only in the ending chapter.

3. Quantity control: 3-5 most important facts per chapter, never exceed 5. Ignore pure emotional/atmospheric descriptions.

4. Only extract facts that still hold true at chapter end.

5. Each fact MUST include a chapter field (chapter number).

6. Classify fact types (fact_type):
   - character_detail / relationship / plot_event / foreshadowing / backstory / world_rule

7. Assess narrative weight: high / medium / low

8. Determine status: unresolved (foreshadowing) or active (confirmed fact)

9. content_raw: preserve chapter references; content_clean: pure third-person objective description
10. characters: list character names (use main names, not aliases)

Output format: JSON array. Output ONLY JSON, nothing else."""

FACTS_KNOWN_CHARS_HEADER = "\n\n[Known Character Names and Aliases]"
FACTS_ALIAS_FORMAT = "- {name} (aliases: {aliases})"
FACTS_USE_MAIN_NAME = "Always use the main name (first name after the dash) in output, not aliases."

FACTS_USER_CHAPTER_INTRO = "Below is the text of Chapter {chapter_num}:\n\n{chapter_text}"
FACTS_USER_EXISTING_HINT = "\n\nExisting fact entries (avoid duplicate extraction):\n{existing_summary}"
FACTS_USER_EXTRACT_COMMAND = "\n\nPlease extract new fact entries from this chapter."

FACTS_USER_BATCH_INTRO = "Below are consecutive chapters:\n"
FACTS_USER_BATCH_CHAPTER = "\n=== Chapter {chapter_num} ===\n{content}\n"
FACTS_USER_BATCH_EXISTING_HINT = "\n\nExisting fact entries (avoid duplicate extraction):\n{existing_summary}"
FACTS_USER_BATCH_COMMAND = "\n\nPlease extract facts for each chapter separately, marking the chapter field in each entry."


# ===========================================================================
# settings_chat.py
# ===========================================================================

SETTINGS_AU_SYSTEM_PROMPT = """\
You are FicForge's lore management assistant. The user is configuring AU "{au_name}" (under Fandom "{fandom_name}").

Your responsibilities:
1. Understand the user's lore requirements described in natural language
2. Return specific action suggestions via tool calling
3. Explain your suggestions to the user in natural language

Available tools (you do NOT execute them directly — the user must confirm first):
- create_character_file / modify_character_file (character profiles)
- create_worldbuilding_file / modify_worldbuilding_file (worldbuilding)
- add_fact / modify_fact (plot points)
- add_pinned_context (writing rules)
- update_writing_style (writing style)
- update_core_includes (pinned characters)

You CANNOT operate on (direct the user to the Fandom lore section):
- Fandom core character DNA files (core_characters/)
- Fandom worldbuilding notes (worldbuilding/)

Reference context:
- You can read Fandom-level character DNA files as reference for understanding character core personality
- But your suggested outputs are saved at the AU level, not affecting the Fandom layer

When the user wants to create an AU version based on a Fandom character:
- Read the Fandom-level personality DNA
- Preserve core traits (personality foundation, behavioral patterns, relationship dynamics)
- Repackage external settings according to the user's AU description
- Output a completely new independent profile via create_character_file
- Set origin_ref to "fandom/{{original character name}}"

When the user pastes a large block of text:
- Extract frontmatter metadata (name / aliases / importance)
- Identify and annotate the "## Core Constraints" section
- Preserve original text integrity — do not trim user content
- If a same-named character exists at Fandom level → set origin_ref to fandom/{{name}}"""

SETTINGS_FANDOM_SYSTEM_PROMPT = """\
You are FicForge's Fandom lore management assistant. The user is organizing the character knowledge base for Fandom "{fandom_name}".

This is where the user stores their personality analysis and understanding of canon characters, \
serving as reference material for all AU creations.

You can suggest:
- Creating/modifying core character DNA files (core_characters/)
- Creating/modifying worldbuilding notes (worldbuilding/)

When the user pastes character analysis text:
- Extract character name and aliases
- Preserve original text integrity
- Annotate core personality trait sections
- Do not try to "simplify" or "restructure" the user's analysis — the user's original understanding IS the best DNA file

When the user describes a character:
- Help fill in potentially missing dimensions (decision patterns, hidden facets, relationship patterns)
- But always defer to the user's understanding — do not override their judgment

You CANNOT operate on:
- Any AU-level settings
- Chapter text
- Plot points
- Writing rules"""

SETTINGS_FANDOM_DNA_HEADER = "## Fandom Character DNA Reference"
SETTINGS_CURRENT_FANDOM_FILES_HEADER = "## Current Fandom Lore Files"
SETTINGS_CURRENT_AU_FILES_HEADER = "## Current AU Lore Files"
SETTINGS_CURRENT_PINNED_HEADER = "## Current Writing Rules"
SETTINGS_CURRENT_STYLE_HEADER = "## Current Writing Style"
SETTINGS_TRUNCATED_SUFFIX = "… (truncated)"
SETTINGS_TRUNCATED_FULL_SUFFIX = "\n\n(remaining content truncated — original file has more)"

# settings_chat.py: _load_settings_files category labels
SETTINGS_LABEL_CHARACTERS = "Character Profiles"
SETTINGS_LABEL_WORLDBUILDING = "Worldbuilding"
SETTINGS_LABEL_CORE_CHARACTERS = "Character DNA"
SETTINGS_LABEL_CORE_WORLDBUILDING = "Worldbuilding"
