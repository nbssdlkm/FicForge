"""Prompt key contract.

zh.py and en.py must both define every key listed here.
__init__.py validates at import time — missing keys crash on startup.
"""

REQUIRED_KEYS = [
    # === context_assembler.py: build_system_prompt ===
    "SYSTEM_NOVELIST",
    "PINNED_CONTEXT_HEADER",
    "CONFLICT_RESOLUTION_RULES",
    "PERSPECTIVE_FIRST_PERSON",       # f-string with {pov}
    "PERSPECTIVE_THIRD_PERSON",
    "EMOTION_EXPLICIT",
    "EMOTION_IMPLICIT",
    "FORESHADOWING_RULES",
    "GENERIC_RULES",                  # f-string with {chapter_length}
    "CUSTOM_INSTRUCTIONS_HEADER",

    # === context_assembler.py: build_instruction ===
    "CURRENT_STATUS",                 # f-string with {current_ch}
    "LAST_ENDING_INLINE",             # f-string with {last_ending}
    "FOCUS_GOAL_HEADER",
    "FOCUS_GOAL_DEFINITION",
    "ATTENTION_HEADER",
    "ATTENTION_BODY",
    "BG_RULES",
    "PACING_INSTRUCTION",
    "CONTINUE_WRITING",               # f-string with {user_input}

    # === context_assembler.py: build_facts_layer ===
    "SECTION_PLOT_STATE",
    "UNRESOLVED_DROPPED_HINT",        # f-string with {count}

    # === context_assembler.py: build_recent_chapter_layer ===
    "SECTION_LAST_ENDING",            # f-string with {content}
    "SECTION_LAST_ENDING_TRUNCATED",  # f-string with {end_text}

    # === context_assembler.py: build_core_settings_layer ===
    "SECTION_CHARACTERS",
    "SECTION_WORLDBUILDING",
    "WORD_COUNT_REMINDER",

    # === rag_retrieval.py ===
    "RAG_LABEL_CHARACTERS",
    "RAG_LABEL_WORLDBUILDING",
    "RAG_LABEL_CHAPTERS",

    # === facts_extraction.py ===
    "FACTS_SYSTEM_PROMPT",
    "FACTS_BATCH_SYSTEM_PROMPT",
    "FACTS_KNOWN_CHARS_HEADER",
    "FACTS_ALIAS_FORMAT",             # f-string with {name}, {aliases}
    "FACTS_USE_MAIN_NAME",
    "FACTS_USER_CHAPTER_INTRO",       # f-string with {chapter_num}, {chapter_text}
    "FACTS_USER_EXISTING_HINT",       # f-string with {existing_summary}
    "FACTS_USER_EXTRACT_COMMAND",
    "FACTS_USER_BATCH_INTRO",
    "FACTS_USER_BATCH_CHAPTER",       # f-string with {chapter_num}, {content}
    "FACTS_USER_BATCH_EXISTING_HINT", # f-string with {existing_summary}
    "FACTS_USER_BATCH_COMMAND",

    # === settings_chat.py ===
    "SETTINGS_AU_SYSTEM_PROMPT",      # f-string with {au_name}, {fandom_name}
    "SETTINGS_FANDOM_SYSTEM_PROMPT",  # f-string with {fandom_name}
    "SETTINGS_FANDOM_DNA_HEADER",
    "SETTINGS_CURRENT_FANDOM_FILES_HEADER",
    "SETTINGS_CURRENT_AU_FILES_HEADER",
    "SETTINGS_CURRENT_PINNED_HEADER",
    "SETTINGS_CURRENT_STYLE_HEADER",
    "SETTINGS_TRUNCATED_SUFFIX",
    "SETTINGS_TRUNCATED_FULL_SUFFIX",

    # settings_chat.py: category labels for _load_settings_files
    "SETTINGS_LABEL_CHARACTERS",
    "SETTINGS_LABEL_WORLDBUILDING",
    "SETTINGS_LABEL_CORE_CHARACTERS",
    "SETTINGS_LABEL_CORE_WORLDBUILDING",

    # === chapters.py: AI chapter title generation ===
    "CHAPTER_TITLE_PROMPT",             # f-string with {content}
]
