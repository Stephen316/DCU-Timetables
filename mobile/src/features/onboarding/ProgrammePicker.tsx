import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { categoryCode, categoryDescriptiveName, TimetableCategory } from '../../core/timetableEvent';
import { errorMessage } from '../../data/rest';
import { useServices } from '../../state/hooks';
import { EmptyState, Icon, Label, ListScroll, Row, Section, Spinner, Txt } from '../../ui/components';
import { Radius, Space, useTheme } from '../../ui/theme';
import { ScreenTitle } from './ScreenTitle';

/** Search DCU programmes of study and pick one. */
export function ProgrammePicker({ onSelect }: { onSelect: (category: TimetableCategory) => void }) {
  const theme = useTheme();
  const services = useServices();
  const source = services.sourceOverride ?? services.dcu;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TimetableCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  // Under two letters there is nothing to search for, whatever an earlier search found.
  const searching = query.trim().length >= 2;
  const shown = searching ? results : [];
  const shownError = searching ? errorText : null;

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    let cancelled = false;
    // Debounce: wait for the typing to pause before asking.
    const timer = setTimeout(() => {
      setLoading(true);
      setErrorText(null);
      source
        .searchProgrammes(trimmed)
        .then((found) => !cancelled && setResults(found))
        .catch((error) => {
          if (cancelled) return;
          setResults([]);
          setErrorText(errorMessage(error, "Couldn't search right now."));
        })
        .finally(() => !cancelled && setLoading(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, source]);

  return (
    <ListScroll>
      <ScreenTitle title="Your programme" />
      <Section bare>
        <View style={[styles.search, { backgroundColor: theme.raised }]}>
          <Icon name="search" size={16} color={theme.inkSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Name or code"
            placeholderTextColor={theme.inkTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.input, { color: theme.ink }]}
            accessibilityLabel="Search programmes"
          />
        </View>
      </Section>

      {shownError ? (
        <Section>
          <Row><Label icon="warning" text={shownError} color={theme.inkSecondary} /></Row>
        </Section>
      ) : null}
      {searching && loading && shown.length === 0 ? <Spinner /> : null}
      {shown.length > 0 ? (
        <Section>
          {shown.map((category) => (
            <Row key={category.identity} onPress={() => onSelect(category)} accessibilityLabel={category.name}>
              <Txt type="headline">{categoryCode(category)}</Txt>
              <Txt type="subheadline" color={theme.inkSecondary}>{categoryDescriptiveName(category)}</Txt>
            </Row>
          ))}
        </Section>
      ) : null}
      {shown.length === 0 && !loading && !shownError ? (
        <EmptyState
          icon="search"
          title={query.trim().length === 0 ? 'Find your programme' : 'No matches'}
          message={query.trim().length === 0 ? 'Search for your course, e.g. "Computer" or a code like "CASE".' : 'Try a different search.'}
        />
      ) : null}
    </ListScroll>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: Space.s, borderRadius: Radius.control, paddingHorizontal: Space.m },
  input: { flex: 1, fontSize: 17, minHeight: 40 },
});
