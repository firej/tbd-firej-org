package handlers

import "net/http"

// AppPage — GET / для авторизованного пользователя.
// Отдаёт пустой каркас; задачи фронт подтягивает через GET /api/tasks.
func (h *Handler) AppPage(w http.ResponseWriter, r *http.Request) {
	uid, _ := h.userID(r)
	user, err := h.loadUser(uid)
	if err != nil {
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}
	h.render(w, "app.html", map[string]interface{}{
		"Title": "tobedone",
		"User":  user,
	})
}
