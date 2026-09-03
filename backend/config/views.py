from django.http import JsonResponse

# Plain Django view, not a DRF one: REST_FRAMEWORK's DEFAULT_PERMISSION_CLASSES
# is IsAuthenticated globally, and this specifically needs to be reachable
# with no credentials - it exists for uptime monitors/keep-alive pings
# (Render's free tier sleeps a web service after 15 minutes idle), not for
# app clients.
def health_check(request):
    return JsonResponse({"status": "ok"})
