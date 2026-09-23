-- =============================================================================
-- THREE APPEARANCES, ONE APPLICATION.
--
-- The owner, 23 September 2026, on the Eventide direction: "Implement three
-- first-class appearance modes… All three modes must use one shared component
-- system, information architecture, and functional implementation… The
-- selected appearance must persist appropriately between sessions and across
-- mobile and desktop."
--
-- ACROSS DEVICES is what decides where this lives. A cookie persists a choice
-- on the phone that made it and nowhere else, so the desk would keep asking
-- the system what he wanted while the phone already knew. The choice is a fact
-- about the person, so it belongs on the person.
--
-- NOT IN `owner_preferences`, which is the nearest-looking table and the wrong
-- one. That table holds governed, immutable, one-way economic statements about
-- how the institution should behave — things a later reader is entitled to
-- treat as instructions. How a screen is painted is not one of those, and
-- filing it there would put a display setting inside a record that decides
-- what Foundry pursues.
--
-- NULL MEANS HE HAS NOT SAID, which is a different fact from choosing green.
-- Unset follows the device: the system's own light or dark preference picks
-- between the light palette and the signature green one. That is the calm
-- default, and it stops the institution asserting a preference he never
-- expressed.
-- =============================================================================

ALTER TABLE founders ADD COLUMN appearance TEXT;

-- THE VOCABULARY IS THE STYLESHEET'S. `owner.css` declares exactly three
-- palettes — the bare :root (green), [data-theme="light"] and
-- [data-theme="dark"] — and a fourth value here would render as no palette at
-- all: the attribute would be present, the selector would match nothing, and
-- the page would fall through to green while the record said otherwise. A
-- CHECK cannot be added by ALTER in SQLite, so it is a trigger, on both paths.
CREATE TRIGGER founder_appearance_is_one_the_stylesheet_has
BEFORE UPDATE OF appearance ON founders
BEGIN
  SELECT RAISE(ABORT,'founder_appearance:not_a_mode')
    WHERE NEW.appearance IS NOT NULL
      AND NEW.appearance NOT IN ('light','green','dark');
END;

CREATE TRIGGER founder_appearance_is_one_the_stylesheet_has_at_birth
BEFORE INSERT ON founders
BEGIN
  SELECT RAISE(ABORT,'founder_appearance:not_a_mode')
    WHERE NEW.appearance IS NOT NULL
      AND NEW.appearance NOT IN ('light','green','dark');
END;
