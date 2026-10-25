import { ItemsView } from "../components/ItemsView";
import { t, I18N } from "../i18n";

export default function Favorites() {
  return <ItemsView title={t(I18N.FAVORITES)} favoritesOnly showQuickAdd={false} />;
}
